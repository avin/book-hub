import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReaderFontSample,
  isReaderLayoutFontReady,
  loadReaderLayoutFonts,
  readerLayoutFontSpec,
  fontFamilyForMeasurement,
} from './reflowableFontMetrics';
import { defaultSettings } from './reflowableReaderSettings';
import type { ReflowableBlock, ReflowableDocument } from './reflowableTypes';

const settings = { ...defaultSettings, fontFamily: '"Literata", serif' };
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
});

function mockFonts() {
  const check = vi.fn(() => true);
  const load = vi.fn<(font: string, text?: string) => Promise<FontFace[]>>(() =>
    Promise.resolve([]),
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { check, load } });
  return { check, load };
}

function block(inlines: ReflowableBlock['inlines']): ReflowableBlock {
  return { id: 'block', kind: 'paragraph', role: 'body', level: 0, inlines };
}

describe('шрифты адаптивной книги', () => {
  it('загружает выбранную насыщенность и измеряет тот же оптический вариант, что и DOM', async () => {
    const fonts = mockFonts();
    const custom = { ...settings, fontWeight: 525, fontOpticalSize: 24 };
    await loadReaderLayoutFonts(custom, { text: 'Текст', codeText: 'code' });
    expect(fonts.load).toHaveBeenCalledWith('normal 525 19px "Book Hub Literata opsz 24"', 'Текст');
    expect(fonts.load).toHaveBeenCalledWith('normal 700 19px "Book Hub Literata opsz 24"', 'Текст');
    expect(fonts.load).toHaveBeenCalledWith('normal 400 17.48px "Cousine"', 'code');
    expect(readerLayoutFontSpec(custom)).toContain(fontFamilyForMeasurement(custom));
  });

  it('собирает символы из вложенного текста, таблиц и сносок без повторений', () => {
    const book: ReflowableDocument = {
      title: '',
      authors: [],
      outline: [],
      binaries: new Map(),
      blocks: [
        block([
          { kind: 'text', text: 'ААБ' },
          { kind: 'emphasis', children: [{ kind: 'text', text: 'Ж🙂' }] },
          { kind: 'code', children: [{ kind: 'text', text: 'Жx' }] },
        ]),
        {
          ...block([]),
          kind: 'table',
          rows: [
            {
              cells: [
                { header: false, colspan: 1, rowspan: 1, inlines: [{ kind: 'text', text: 'Ω' }] },
              ],
            },
          ],
        },
        { ...block([{ kind: 'text', text: 'y' }]), kind: 'codeBlock' },
      ],
      notes: new Map([['note', { id: 'note', blocks: [block([{ kind: 'text', text: 'Ї' }])] }]]),
    };

    const sample = createReaderFontSample(book);
    expect([...sample.text].sort()).toEqual(['А', 'Б', 'Ж', '🙂', 'x', 'Ω', 'y', 'Ї'].sort());
    expect([...sample.codeText].sort()).toEqual(['Ж', 'x', 'y'].sort());
  });

  it('проверяет и загружает кириллический subset во всех начертаниях', async () => {
    const { check, load } = mockFonts();
    const sample = { text: 'Аa', codeText: '' };
    check.mockImplementation((...args: unknown[]) => args[1] !== sample.text);
    expect(isReaderLayoutFontReady(settings, sample)).toBe(false);

    await loadReaderLayoutFonts(settings, sample);

    expect(load).toHaveBeenCalledTimes(4);
    for (const [font, text] of load.mock.calls) {
      expect(font).toContain('"Literata"');
      expect(text).toBe('Аa');
    }
    expect(load).toHaveBeenCalledWith('italic 700 19px "Literata"', 'Аa');
  });

  it('ожидает все subset-загрузки, включая моноширинный шрифт кода', async () => {
    const { load } = mockFonts();
    let release!: (fonts: FontFace[]) => void;
    // Все четыре начертания кода используют один управляемый gate.
    const codeGate = new Promise<FontFace[]>((resolve) => {
      release = resolve;
    });
    load.mockImplementation((font) =>
      font.includes('"Cousine"') ? codeGate : Promise.resolve([]),
    );
    let complete = false;
    const loading = loadReaderLayoutFonts(settings, { text: 'Я', codeText: 'Я' }).then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(load.mock.calls.filter(([font]) => font.includes('"Cousine"'))).toHaveLength(4);
    release([]);
    await loading;
    expect(complete).toBe(true);
  });

  it('разрешает fallback после ошибки шрифта, дождавшись остальных загрузок', async () => {
    const { load } = mockFonts();
    let release!: (fonts: FontFace[]) => void;
    const lastFont = new Promise<FontFace[]>((resolve) => {
      release = resolve;
    });
    load
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(lastFont);
    let complete = false;
    const loading = loadReaderLayoutFonts(settings, { text: 'Текст', codeText: '' }).then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    release([]);
    await expect(loading).resolves.toBeUndefined();
    expect(complete).toBe(true);
  });
});
