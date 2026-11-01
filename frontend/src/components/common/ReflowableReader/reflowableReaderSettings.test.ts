import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  readerFontOpticalSize,
  readerFontWeight,
} from './reflowableReaderSettings';
import { readerFontFamily } from './reflowableFontVariants';

describe('параметры вариативных шрифтов', () => {
  it('сохраняет обычную насыщенность и автоматический оптический размер старого профиля', () => {
    const settings = { ...defaultSettings, fontFamily: '"Literata", serif' };
    expect(readerFontWeight(settings)).toBe(400);
    expect(readerFontWeight(settings, 700)).toBe(700);
    expect(readerFontOpticalSize(settings)).toBeUndefined();
    expect(readerFontFamily(settings)).toBe(settings.fontFamily);
  });

  it('ограничивает параметры диапазонами выбранного шрифта, сохраняя выделения', () => {
    const settings = {
      ...defaultSettings,
      fontFamily: '"Inter", sans-serif',
      fontWeight: 500,
      fontOpticalSize: 144,
    };
    expect(readerFontWeight(settings)).toBe(500);
    expect(readerFontWeight(settings, 700)).toBe(700);
    expect(readerFontOpticalSize(settings)).toBe(32);
    expect(readerFontWeight({ ...settings, fontFamily: '"Lora", serif', fontWeight: 100 })).toBe(
      400,
    );
    expect(readerFontWeight({ ...settings, fontWeight: 900 }, 700)).toBe(900);
  });

  it('не применяет неподдерживаемые оси к статическим и системным шрифтам', () => {
    for (const fontFamily of ['"PT Serif", serif', 'system-ui, sans-serif']) {
      const settings = { ...defaultSettings, fontFamily, fontWeight: 650, fontOpticalSize: 20 };
      expect(readerFontWeight(settings)).toBe(400);
      expect(readerFontOpticalSize(settings)).toBeUndefined();
      expect(readerFontFamily(settings)).toBe(fontFamily);
    }
    const settings = {
      ...defaultSettings,
      fontFamily: '"Roboto", sans-serif',
      fontOpticalSize: 20,
    };
    expect(readerFontOpticalSize(settings)).toBeUndefined();
    expect(readerFontFamily(settings)).toBe(settings.fontFamily);
  });
});
