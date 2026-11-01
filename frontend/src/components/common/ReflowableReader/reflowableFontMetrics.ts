import type {
  ReflowableBlock,
  ReflowableDocument,
  ReflowableInline,
  ReflowableReaderSettings,
} from './reflowableTypes';

export type ReaderFontSample = {
  text: string;
  codeText: string;
};

export function createReaderFontSample(book: ReflowableDocument): ReaderFontSample {
  const text: string[] = [];
  const codeText: string[] = [];
  // One bit per Unicode code point avoids hashing every character of a long book.
  const textCharacters = new Uint8Array(0x110000 >>> 3);
  const codeCharacters = new Uint8Array(0x110000 >>> 3);
  const visitInlines = (inlines: ReflowableInline[] | undefined, code = false) => {
    for (const inline of inlines ?? []) {
      const isCode = code || inline.kind === 'code';
      const source = inline.text ?? '';
      for (let index = 0; index < source.length; index += 1) {
        const point = source.codePointAt(index)!;
        const byte = point >>> 3;
        const bit = 1 << (point & 7);
        if (!(textCharacters[byte] & bit)) {
          textCharacters[byte] |= bit;
          text.push(String.fromCodePoint(point));
        }
        if (isCode && !(codeCharacters[byte] & bit)) {
          codeCharacters[byte] |= bit;
          codeText.push(String.fromCodePoint(point));
        }
        if (point > 0xffff) index += 1;
      }
      visitInlines(inline.children, isCode);
    }
  };
  const visitBlocks = (blocks: ReflowableBlock[]) => {
    for (const block of blocks) {
      visitInlines(block.inlines, block.kind === 'codeBlock');
      for (const row of block.rows ?? []) {
        for (const cell of row.cells) visitInlines(cell.inlines);
      }
    }
  };

  visitBlocks(book.blocks);
  for (const note of book.notes.values()) visitBlocks(note.blocks);

  // FontFaceSet uses these characters to select unicode-range subsets.
  // Keeping each character once avoids passing the entire book to every load.
  return { text: text.join(''), codeText: codeText.join('') };
}

function primaryFontFamily(fontFamily: string) {
  const trimmed = fontFamily.trim();
  const quoted = trimmed.match(/^["']([^"']+)["']/);

  if (quoted) {
    return quoted[1];
  }

  return trimmed.split(',')[0]?.trim() ?? trimmed;
}

export function isSystemFontStack(fontFamily: string) {
  const primary = primaryFontFamily(fontFamily).toLowerCase();

  return (
    primary === 'system-ui' ||
    primary === 'ui-sans-serif' ||
    primary === 'sans-serif' ||
    primary === 'serif' ||
    primary === 'monospace'
  );
}

export function readerLayoutFontSpec(
  settings: ReflowableReaderSettings,
  fontSize = settings.fontSize,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
) {
  const family = isSystemFontStack(settings.fontFamily)
    ? settings.fontFamily
    : `"${primaryFontFamily(settings.fontFamily)}"`;

  return `${style} ${weight} ${fontSize}px ${family}`;
}

function layoutFontRequests(
  settings: ReflowableReaderSettings,
  sample: ReaderFontSample = { text: ' ', codeText: '' },
) {
  const variants = [
    readerLayoutFontSpec(settings),
    readerLayoutFontSpec(settings, settings.fontSize, 700),
    readerLayoutFontSpec(settings, settings.fontSize, 500, 'italic'),
    readerLayoutFontSpec(settings, settings.fontSize, 700, 'italic'),
  ];
  const requests = variants.map((font) => ({ font, text: sample.text }));

  if (sample.codeText) {
    const codeSettings = { ...settings, fontFamily: '"Cousine", monospace' };
    for (const weight of [400, 700]) {
      for (const style of ['normal', 'italic'] as const) {
        requests.push({
          font: readerLayoutFontSpec(codeSettings, settings.fontSize * 0.92, weight, style),
          text: sample.codeText,
        });
      }
    }
  }

  return requests;
}

export function isReaderLayoutFontReady(
  settings: ReflowableReaderSettings,
  sample?: ReaderFontSample,
) {
  if (typeof document === 'undefined') {
    return true;
  }

  return layoutFontRequests(settings, sample).every(({ font, text }) =>
    document.fonts.check(font, text),
  );
}

export function loadReaderLayoutFonts(
  settings: ReflowableReaderSettings,
  sample?: ReaderFontSample,
) {
  if (typeof document === 'undefined') {
    return Promise.resolve();
  }

  const loads = layoutFontRequests(settings, sample).map(({ font, text }) =>
    document.fonts.load(font, text),
  );

  return Promise.allSettled(loads).then(() => undefined);
}

export function fontFamilyForMeasurement(settings: ReflowableReaderSettings) {
  if (isSystemFontStack(settings.fontFamily)) {
    return settings.fontFamily.includes(',') ? settings.fontFamily : `"${settings.fontFamily}"`;
  }

  return `"${primaryFontFamily(settings.fontFamily)}"`;
}

export function webFontMeasureWidthFudge(settings: ReflowableReaderSettings) {
  if (isSystemFontStack(settings.fontFamily)) {
    return 0;
  }

  return Math.max(2, Math.round(settings.fontSize * 0.14));
}
