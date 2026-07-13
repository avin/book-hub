import {
  layoutNextRichInlineLineRange,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
  type RichInlineItem,
} from '@chenglou/pretext/rich-inline';
import { fontFamilyForMeasurement, webFontMeasureWidthFudge } from './fb2FontMetrics';
import { Fb2Block, Fb2Inline, Fb2ReaderSettings, Fb2TableCell, VirtualLayout } from './fb2Types';

const minMeasureWidth = 240;
const quoteInset = 32;
const titlePaddingTop = 8;
const inlineCodeHorizontalPaddingEm = 0.36;

type MeasureWidths = {
  lineWidth: number;
  firstLineWidth?: number;
};

type TextMetrics = {
  fontSize: number;
  lineHeightPx: number;
  font: string;
  marginBlock: number;
};

function fontFamily(settings: Fb2ReaderSettings) {
  return fontFamilyForMeasurement(settings);
}

function fontString(settings: Fb2ReaderSettings, fontSize: number, weight = 400, style = 'normal') {
  return `${style} ${weight} ${fontSize}px ${fontFamily(settings)}`;
}

function blockFont(
  block: Fb2Block,
  settings: Fb2ReaderSettings,
  fontSize: number,
  defaultWeight = 400,
  defaultStyle = 'normal',
) {
  const weight =
    block.textStyle?.fontWeight === 'bold'
      ? 700
      : block.textStyle?.fontWeight === 'normal'
        ? 400
        : defaultWeight;
  const style = block.textStyle?.fontStyle ?? defaultStyle;
  return fontString(settings, fontSize, weight, style);
}

function fontSizeFrom(font: string, fallback: number) {
  return Number(font.match(/\s(\d+(?:\.\d+)?)px\s/)?.[1]) || fallback;
}

function textMetrics(block: Fb2Block, settings: Fb2ReaderSettings): TextMetrics {
  switch (block.kind) {
    case 'title': {
      const fontSize = settings.fontSize * (block.level === 1 ? 1.72 : 1.58);
      return {
        fontSize,
        lineHeightPx: fontSize * 1.22,
        font: blockFont(block, settings, fontSize, 700),
        marginBlock: settings.paragraphSpacing + 24,
      };
    }
    case 'subtitle': {
      const fontSize = settings.fontSize * 1.16;
      return {
        fontSize,
        lineHeightPx: fontSize * 1.28,
        font: blockFont(block, settings, fontSize, 650),
        marginBlock: settings.paragraphSpacing + 12,
      };
    }
    case 'poemLine':
      return {
        fontSize: settings.fontSize,
        lineHeightPx: settings.fontSize * settings.lineHeight,
        font: blockFont(block, settings, settings.fontSize, 400, 'italic'),
        marginBlock: 4,
      };
    case 'textAuthor':
    case 'date': {
      const fontSize = settings.fontSize * 0.94;
      return {
        fontSize,
        lineHeightPx: fontSize * settings.lineHeight,
        font: blockFont(block, settings, fontSize, 500, 'italic'),
        marginBlock: settings.paragraphSpacing,
      };
    }
    default:
      return {
        fontSize: settings.fontSize,
        lineHeightPx: settings.fontSize * settings.lineHeight,
        font: blockFont(block, settings, settings.fontSize),
        marginBlock: settings.paragraphSpacing,
      };
  }
}

function inlineFont(inline: Fb2Inline, inheritedFont: string, settings: Fb2ReaderSettings) {
  const fontStyle =
    inline.textStyle?.fontStyle ?? (inline.kind === 'emphasis' ? 'italic' : undefined);
  const fontWeight =
    inline.textStyle?.fontWeight ?? (inline.kind === 'strong' ? 'bold' : undefined);

  if (inline.kind === 'code')
    return `${fontSizeFrom(inheritedFont, settings.fontSize) * 0.92}px "Cousine", monospace`;
  if (!fontStyle && !fontWeight) return inheritedFont;

  const match = inheritedFont.match(/^(\S+)\s+(\d+)\s+(.+)$/);
  if (!match) return inheritedFont;

  return `${fontStyle ?? match[1]} ${fontWeight === 'bold' ? 700 : fontWeight === 'normal' ? 400 : match[2]} ${match[3]}`;
}

function richInlineLines(
  inlines: Fb2Inline[] | undefined,
  inheritedFont: string,
  settings: Fb2ReaderSettings,
) {
  const lines: RichInlineItem[][] = [[]];
  const append = (inline: Fb2Inline, font: string) => {
    if (inline.kind === 'lineBreak') {
      lines.push([]);
      return;
    }

    if (inline.kind === 'text') {
      if (inline.text) lines.at(-1)?.push({ text: inline.text, font });
      return;
    }

    if (inline.kind === 'image') {
      lines.at(-1)?.push({
        text: '\uFFFC',
        font,
        break: 'never',
        extraWidth: settings.fontSize * 2.2,
      });
      return;
    }

    if (inline.kind === 'code') {
      const text = inlinePlainText(inline);
      const codeFont = inlineFont(inline, font, settings);
      if (text) {
        lines.at(-1)?.push({
          text,
          font: codeFont,
          extraWidth: fontSizeFrom(codeFont, settings.fontSize) * inlineCodeHorizontalPaddingEm,
        });
      }
      return;
    }

    const childFont = inlineFont(inline, font, settings);
    (inline.children ?? []).forEach((child) => append(child, childFont));
  };

  (inlines ?? []).forEach((inline) => append(inline, inheritedFont));
  return lines;
}

function inlinePlainText(inline: Fb2Inline): string {
  if (inline.kind === 'text') {
    return inline.text ?? '';
  }

  if (inline.kind === 'lineBreak') {
    return '\n';
  }

  if (inline.kind === 'image') {
    return '\uFFFC';
  }

  return (inline.children ?? []).map(inlinePlainText).join('');
}

function tightenMeasureWidth(width: number, settings: Fb2ReaderSettings) {
  return Math.max(minMeasureWidth, width - webFontMeasureWidthFudge(settings));
}

function measureWidthsForBlock(
  block: Fb2Block,
  width: number,
  settings: Fb2ReaderSettings,
): MeasureWidths {
  const measureWidth = tightenMeasureWidth(width, settings);

  if (
    block.role === 'annotation' ||
    block.role === 'metadata' ||
    block.role === 'cite' ||
    block.role === 'epigraph'
  ) {
    return { lineWidth: Math.max(minMeasureWidth, measureWidth - quoteInset) };
  }

  if (block.kind === 'listItem') {
    return { lineWidth: Math.max(minMeasureWidth, measureWidth - settings.paragraphIndent) };
  }

  if (block.kind === 'poemLine') {
    return { lineWidth: Math.max(minMeasureWidth, measureWidth - settings.paragraphIndent * 1.2) };
  }

  if (block.kind === 'paragraph') {
    return {
      lineWidth: measureWidth,
      firstLineWidth: Math.max(minMeasureWidth, measureWidth - settings.paragraphIndent),
    };
  }

  return { lineWidth: measureWidth };
}

function measureRichLineCount(prepared: PreparedRichInline, widths: MeasureWidths) {
  let lineCount = 0;
  let cursor: RichInlineCursor | undefined;

  for (;;) {
    const maxWidth =
      lineCount === 0 && widths.firstLineWidth !== undefined
        ? widths.firstLineWidth
        : widths.lineWidth;
    const line = layoutNextRichInlineLineRange(
      prepared,
      Math.max(minMeasureWidth, maxWidth),
      cursor,
    );

    if (!line) {
      break;
    }

    lineCount += 1;
    cursor = line.end;
  }

  return Math.max(1, lineCount);
}

function measureInlinesHeight(
  inlines: Fb2Inline[] | undefined,
  widths: MeasureWidths,
  metrics: TextMetrics,
  settings: Fb2ReaderSettings,
) {
  const lineCount = richInlineLines(inlines, metrics.font, settings).reduce(
    (total, items) =>
      total + (items.length ? measureRichLineCount(prepareRichInline(items), widths) : 1),
    0,
  );

  return Math.max(1, lineCount) * metrics.lineHeightPx + metrics.marginBlock;
}

function measureCodeBlock(block: Fb2Block, width: number, settings: Fb2ReaderSettings) {
  const fontSize = settings.fontSize * 0.92;
  const lineHeightPx = fontSize * 1.45;
  const text = (block.inlines ?? []).map(inlinePlainText).join('').replace(/\s+$/, '');
  const lines = text.length > 0 ? text.split(/\r\n|\r|\n/) : [''];
  const averageCharWidth = fontSize * 0.62;
  const contentWidth = Math.max(minMeasureWidth, width - 32);
  const visualLineCount = lines.reduce(
    (total, line) =>
      total + Math.max(1, Math.ceil((line.length * averageCharWidth) / contentWidth)),
    0,
  );

  return visualLineCount * lineHeightPx + settings.paragraphSpacing + 28;
}

function measureTableCell(cell: Fb2TableCell, width: number, settings: Fb2ReaderSettings) {
  const metrics = {
    fontSize: settings.fontSize * 0.94,
    lineHeightPx: settings.fontSize * 0.94 * 1.42,
    font: fontString(settings, settings.fontSize * 0.94, cell.header ? 700 : 400),
    marginBlock: 16,
  };

  return measureInlinesHeight(cell.inlines, { lineWidth: width }, metrics, settings);
}

function measureTable(block: Fb2Block, width: number, settings: Fb2ReaderSettings) {
  const rows = block.rows ?? [];

  if (rows.length === 0) {
    return settings.fontSize * settings.lineHeight + settings.paragraphSpacing;
  }

  return (
    rows.reduce((total, row) => {
      const columnCount = Math.max(
        1,
        row.cells.reduce((sum, cell) => sum + cell.colspan, 0),
      );
      const rowHeight = row.cells.reduce((height, cell) => {
        const cellWidth = (width / columnCount) * cell.colspan - 24;

        return Math.max(height, measureTableCell(cell, cellWidth, settings));
      }, 0);

      return total + rowHeight;
    }, 0) +
    settings.paragraphSpacing +
    2
  );
}

function measureBlockHeight(block: Fb2Block, width: number, settings: Fb2ReaderSettings) {
  switch (block.kind) {
    case 'emptyLine':
      return settings.fontSize * settings.lineHeight;
    case 'divider':
      return settings.fontSize * 2.4;
    case 'codeBlock':
      return measureCodeBlock(block, width, settings);
    case 'image':
      return Math.min(520, Math.max(220, width * 0.58)) + settings.paragraphSpacing + 12;
    case 'table':
      return measureTable(block, width, settings);
    default: {
      const height = measureInlinesHeight(
        block.inlines,
        measureWidthsForBlock(block, width, settings),
        textMetrics(block, settings),
        settings,
      );

      return block.kind === 'title' ? height + titlePaddingTop : height;
    }
  }
}

export function buildVirtualLayout(
  blocks: Fb2Block[],
  width: number,
  settings: Fb2ReaderSettings,
): VirtualLayout {
  const heights = blocks.map((block) => measureBlockHeight(block, width, settings));
  const offsets: number[] = [];
  let totalHeight = 0;

  heights.forEach((height) => {
    offsets.push(totalHeight);
    totalHeight += height;
  });

  return { offsets, heights, totalHeight };
}

export function findBlockIndex(offsets: number[], scrollTop: number) {
  let low = 0;
  let high = offsets.length - 1;
  let result = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (offsets[middle] <= scrollTop) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}
