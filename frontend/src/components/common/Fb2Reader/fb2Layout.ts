import { measureRichInlineStats, prepareRichInline, RichInlineItem } from "@chenglou/pretext/rich-inline";
import { Fb2Block, Fb2Inline, Fb2ReaderSettings, Fb2TableCell, VirtualLayout } from "./fb2Types";

const minMeasureWidth = 240;

type TextMetrics = {
  fontSize: number;
  lineHeightPx: number;
  font: string;
  marginBlock: number;
};

function fontFamily(settings: Fb2ReaderSettings) {
  return settings.fontFamily.includes(",") ? settings.fontFamily : `"${settings.fontFamily}"`;
}

function fontString(settings: Fb2ReaderSettings, fontSize: number, weight = 400, style = "normal") {
  return `${style} ${weight} ${fontSize}px ${fontFamily(settings)}`;
}

function textMetrics(block: Fb2Block, settings: Fb2ReaderSettings): TextMetrics {
  switch (block.kind) {
    case "title": {
      const fontSize = settings.fontSize * (block.level === 1 ? 1.72 : 1.58);
      return {
        fontSize,
        lineHeightPx: fontSize * 1.22,
        font: fontString(settings, fontSize, 700),
        marginBlock: settings.paragraphSpacing + 24,
      };
    }
    case "subtitle": {
      const fontSize = settings.fontSize * 1.16;
      return {
        fontSize,
        lineHeightPx: fontSize * 1.28,
        font: fontString(settings, fontSize, 650),
        marginBlock: settings.paragraphSpacing + 12,
      };
    }
    case "poemLine":
      return {
        fontSize: settings.fontSize,
        lineHeightPx: settings.fontSize * settings.lineHeight,
        font: fontString(settings, settings.fontSize, 400, "italic"),
        marginBlock: 4,
      };
    case "textAuthor":
    case "date": {
      const fontSize = settings.fontSize * 0.94;
      return {
        fontSize,
        lineHeightPx: fontSize * settings.lineHeight,
        font: fontString(settings, fontSize, 500, "italic"),
        marginBlock: settings.paragraphSpacing,
      };
    }
    default:
      return {
        fontSize: settings.fontSize,
        lineHeightPx: settings.fontSize * settings.lineHeight,
        font: fontString(settings, settings.fontSize),
        marginBlock: settings.paragraphSpacing,
      };
  }
}

function inlineToRichItems(inline: Fb2Inline, inheritedFont: string, settings: Fb2ReaderSettings): RichInlineItem[] {
  if (inline.kind === "text") {
    return inline.text ? [{ text: inline.text, font: inheritedFont }] : [];
  }

  if (inline.kind === "image") {
    return [{ text: "\uFFFC", font: inheritedFont, break: "never", extraWidth: settings.fontSize * 2.2 }];
  }

  const childFont = (() => {
    switch (inline.kind) {
      case "strong":
        return inheritedFont.replace(/^\S+\s+\d+\s+/, `normal 700 `);
      case "emphasis":
        return inheritedFont.replace(/^\S+\s+/, "italic ");
      case "code":
        return `${settings.fontSize}px "Consolas", "Liberation Mono", monospace`;
      default:
        return inheritedFont;
    }
  })();

  return (inline.children ?? []).flatMap((child) => inlineToRichItems(child, childFont, settings));
}

function inlinePlainText(inline: Fb2Inline): string {
  if (inline.kind === "text") {
    return inline.text ?? "";
  }

  if (inline.kind === "image") {
    return "\uFFFC";
  }

  return (inline.children ?? []).map(inlinePlainText).join("");
}

function measureInlinesHeight(
  inlines: Fb2Inline[] | undefined,
  width: number,
  metrics: TextMetrics,
  settings: Fb2ReaderSettings,
) {
  const items = (inlines ?? []).flatMap((inline) => inlineToRichItems(inline, metrics.font, settings));

  if (items.length === 0) {
    return metrics.lineHeightPx + metrics.marginBlock;
  }

  const prepared = prepareRichInline(items);
  const stats = measureRichInlineStats(prepared, Math.max(minMeasureWidth, width));

  return Math.max(1, stats.lineCount) * metrics.lineHeightPx + metrics.marginBlock;
}

function measureCodeBlock(block: Fb2Block, width: number, settings: Fb2ReaderSettings) {
  const fontSize = settings.fontSize * 0.92;
  const lineHeightPx = fontSize * 1.45;
  const text = (block.inlines ?? []).map(inlinePlainText).join("").replace(/\s+$/, "");
  const lines = text.length > 0 ? text.split(/\r\n|\r|\n/) : [""];
  const averageCharWidth = fontSize * 0.62;
  const contentWidth = Math.max(minMeasureWidth, width - 32);
  const visualLineCount = lines.reduce(
    (total, line) => total + Math.max(1, Math.ceil((line.length * averageCharWidth) / contentWidth)),
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

  return measureInlinesHeight(cell.inlines, width, metrics, settings);
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
  const textWidth =
    block.role === "annotation" || block.role === "metadata" || block.role === "cite" || block.role === "epigraph"
      ? Math.max(minMeasureWidth, width - 32)
      : width;

  switch (block.kind) {
    case "emptyLine":
      return settings.fontSize * settings.lineHeight;
    case "divider":
      return settings.fontSize * 2.4;
    case "codeBlock":
      return measureCodeBlock(block, width, settings);
    case "image":
      return Math.min(520, Math.max(220, width * 0.58)) + settings.paragraphSpacing + 12;
    case "table":
      return measureTable(block, width, settings);
    default:
      return measureInlinesHeight(block.inlines, textWidth, textMetrics(block, settings), settings);
  }
}

export function buildVirtualLayout(blocks: Fb2Block[], width: number, settings: Fb2ReaderSettings): VirtualLayout {
  const heights = blocks.map((block) => Math.ceil(measureBlockHeight(block, width, settings)));
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
