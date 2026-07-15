import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFb2ReaderSettingsPreference,
  getFixedLayoutReaderContentWidthPreference,
  getFixedLayoutReaderFilterChainPreference,
  getFixedLayoutReaderHorizontalScrollPositionPreference,
  getFixedLayoutReaderPageWidthOverflowPreference,
  getLanguagePreference,
  getPdfReaderFilterChainPreference,
  getPdfReaderPageWidthOverflowPreference,
  getRecentTagsPreference,
  getThemePreference,
  setFb2ReaderSettingsPreference,
  setFixedLayoutReaderContentWidthPreference,
  setFixedLayoutReaderPageWidthOverflowPreference,
  setLanguagePreference,
  setPdfReaderFilterChainPreference,
  setPdfReaderPageWidthOverflowPreference,
  setRecentTagsPreference,
  setThemePreference,
} from './browserPreferences';
import { defaultSettings } from '@/components/common/Fb2Reader/fb2ReaderSettings';

describe('browserPreferences', () => {
  beforeEach(() => localStorage.clear());

  it('переносит старые языковые настройки и очищает legacy-ключи', () => {
    localStorage.setItem('book-hub-language', 'en');
    localStorage.setItem(
      'book-hub-tags-recent',
      JSON.stringify([' sci-fi ', '', 'sci-fi', 'history']),
    );

    expect(getLanguagePreference()).toBe('en');
    expect(getRecentTagsPreference()).toEqual([' sci-fi ', 'sci-fi', 'history']);
    expect(localStorage.getItem('book-hub-language')).toBeNull();
    expect(localStorage.getItem('book-hub-tags-recent')).toBeNull();
  });

  it('сохраняет только допустимые значения и восстанавливает данные чтения', () => {
    setLanguagePreference('ru');
    setThemePreference('dark-ocean');
    setRecentTagsPreference(['  ', 'fantasy', 'history']);
    setFb2ReaderSettingsPreference(defaultSettings);
    setFixedLayoutReaderContentWidthPreference(840);
    setPdfReaderPageWidthOverflowPreference('book', 999);
    setPdfReaderFilterChainPreference('book', [{ id: 'invert', enabled: true, strength: 2 }]);

    expect(getLanguagePreference()).toBe('ru');
    expect(getThemePreference()).toBe('dark-ocean');
    expect(getRecentTagsPreference()).toEqual(['fantasy', 'history']);
    expect(getFb2ReaderSettingsPreference()).toMatchObject({ fontSize: defaultSettings.fontSize });
    expect(getFixedLayoutReaderContentWidthPreference()).toBe(840);
    expect(getPdfReaderPageWidthOverflowPreference('book')).toBe(80);
    expect(
      getPdfReaderFilterChainPreference('book')?.find((filter) => filter.id === 'invert'),
    ).toMatchObject({ strength: 1 });
  });

  it('игнорирует повреждённые предпочтения', () => {
    localStorage.setItem(
      'book-hub-preferences',
      JSON.stringify({
        version: 1,
        language: 'de',
        theme: 'bad',
        readers: { fixedLayout: { contentWidth: 'wide' } },
      }),
    );

    expect(getLanguagePreference()).toBeUndefined();
    expect(getThemePreference()).toBeUndefined();
    expect(getFixedLayoutReaderContentWidthPreference()).toBeUndefined();
  });

  it('сохраняет значения для пустого, повреждённого и fixed-layout fixtures', () => {
    expect(getFixedLayoutReaderContentWidthPreference()).toBeUndefined();
    expect(getFixedLayoutReaderPageWidthOverflowPreference('book')).toBe(0);

    localStorage.setItem('book-hub-preferences', '{');
    expect(getFixedLayoutReaderContentWidthPreference()).toBeUndefined();
    expect(getFixedLayoutReaderPageWidthOverflowPreference('book')).toBe(0);

    localStorage.setItem(
      'book-hub-preferences',
      JSON.stringify({
        version: 1,
        readers: {
          fixedLayout: {
            contentWidth: 720,
            pageWidthOverflows: { book: 24 },
            horizontalScrollPositions: { book: 0.25 },
            filterChains: { book: [{ id: 'invert', enabled: true, strength: 0.5 }] },
          },
        },
      }),
    );

    expect(getFixedLayoutReaderContentWidthPreference()).toBe(720);
    expect(getFixedLayoutReaderPageWidthOverflowPreference('book')).toBe(24);
    expect(getFixedLayoutReaderHorizontalScrollPositionPreference('book')).toBe(0.25);
    expect(
      getFixedLayoutReaderFilterChainPreference('book')?.find((filter) => filter.id === 'invert'),
    ).toMatchObject({ strength: 0.5 });
  });

  it('читает legacy PDF preferences через fixed-layout fallback и сохраняет диапазон расширения страницы', () => {
    localStorage.setItem(
      'book-hub-preferences',
      JSON.stringify({
        version: 1,
        readers: { pdf: { pageWidthOverflows: { legacy: 25, tooWide: 999 } } },
      }),
    );

    expect(getFixedLayoutReaderPageWidthOverflowPreference('legacy')).toBe(25);
    expect(getFixedLayoutReaderPageWidthOverflowPreference('tooWide')).toBe(80);
    expect(JSON.parse(localStorage.getItem('book-hub-preferences')!).readers).toMatchObject({
      fixedLayout: { pageWidthOverflows: { legacy: 25, tooWide: 999 } },
    });

    setFixedLayoutReaderPageWidthOverflowPreference('current', -4);
    setFixedLayoutReaderPageWidthOverflowPreference('rounded', 12.6);

    expect(getFixedLayoutReaderPageWidthOverflowPreference('current')).toBe(0);
    expect(getFixedLayoutReaderPageWidthOverflowPreference('rounded')).toBe(13);
  });
});
