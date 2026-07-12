import type { Fb2ReaderSettings } from '@/components/common/Fb2Reader/fb2Types';
import {
  sanitizePdfFilterChain,
  type PdfFilterChain,
} from '@/components/common/PdfReader/pdfFilters';
import {
  clampPdfPageWidthOverflow,
  defaultPdfPageWidthOverflow,
} from '@/components/common/PdfReader/pdfPageSettings';
import { type Language, languages } from '@/i18n/messages';
import { type ThemeId, isThemeId } from '@/styles/themes';

const preferencesStorageKey = 'book-hub-preferences';
const legacyLanguageStorageKey = 'book-hub-language';
const legacyRecentTagsStorageKey = 'book-hub-tags-recent';

export type LibraryView = 'list' | 'grid';

const libraryViewValues = new Set<LibraryView>(['list', 'grid']);

type BrowserPreferences = {
  version: 1;
  language?: Language;
  theme?: ThemeId;
  libraryView?: LibraryView;
  recentTags?: string[];
  readers?: {
    fb2?: {
      settings?: Partial<Fb2ReaderSettings>;
    };
    pdf?: {
      contentWidth?: number;
      pageWidthOverflows?: Record<string, unknown>;
      horizontalScrollPositions?: Record<string, unknown>;
      filterChains?: Record<string, unknown>;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && languages.includes(value as Language);
}

function isLibraryView(value: unknown): value is LibraryView {
  return typeof value === 'string' && libraryViewValues.has(value as LibraryView);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unitIntervalNumber(value: unknown) {
  const number = finiteNumber(value);

  return number !== undefined && number >= 0 && number <= 1 ? number : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function parseJson(value: string | null) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readRawPreferences(): BrowserPreferences {
  try {
    const parsed = parseJson(localStorage.getItem(preferencesStorageKey));

    if (!isRecord(parsed)) {
      return { version: 1 };
    }

    return {
      ...parsed,
      version: 1,
    } as BrowserPreferences;
  } catch {
    return { version: 1 };
  }
}

function removeLegacyPreferences() {
  try {
    localStorage.removeItem(legacyLanguageStorageKey);
    localStorage.removeItem(legacyRecentTagsStorageKey);
  } catch {
    // Keep storage failures non-fatal for reader and form controls.
  }
}

function writeRawPreferences(preferences: BrowserPreferences) {
  try {
    localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences));
    return true;
  } catch {
    // localStorage can be unavailable in private mode or restricted contexts.
    return false;
  }
}

function migrateLegacyPreferences(preferences: BrowserPreferences) {
  let migrated = preferences;

  try {
    if (!migrated.language) {
      const language = localStorage.getItem(legacyLanguageStorageKey);
      if (isLanguage(language)) {
        migrated = { ...migrated, language };
      }
    }

    if (!migrated.recentTags) {
      const recentTags = parseJson(localStorage.getItem(legacyRecentTagsStorageKey));
      if (isStringArray(recentTags)) {
        migrated = {
          ...migrated,
          recentTags: recentTags.filter((tag) => tag.trim().length > 0),
        };
      }
    }
  } catch {
    return migrated;
  }

  if (migrated !== preferences && writeRawPreferences(migrated)) {
    removeLegacyPreferences();
  }

  return migrated;
}

function readPreferences() {
  return migrateLegacyPreferences(readRawPreferences());
}

function updatePreferences(update: (preferences: BrowserPreferences) => BrowserPreferences) {
  const nextPreferences = update(readPreferences());

  writeRawPreferences(nextPreferences);
}

function readReaderPreferences() {
  const readers = readPreferences().readers;

  return isRecord(readers) ? readers : undefined;
}

function readerPreferencesForWrite(preferences: BrowserPreferences) {
  return isRecord(preferences.readers) ? preferences.readers : undefined;
}

function pdfReaderPreferencesForWrite(preferences: BrowserPreferences) {
  const readers = preferences.readers;
  const pdf = isRecord(readers) ? readers.pdf : undefined;

  return isRecord(pdf) ? pdf : undefined;
}

function sanitizeFb2ReaderSettings(settings: unknown): Partial<Fb2ReaderSettings> | undefined {
  if (!isRecord(settings)) {
    return undefined;
  }

  const sanitized: Partial<Fb2ReaderSettings> = {};
  const backgroundColor = stringValue(settings.backgroundColor);
  const textColor = stringValue(settings.textColor);
  const linkColor = stringValue(settings.linkColor);
  const fontFamily = stringValue(settings.fontFamily);
  const fontSize = finiteNumber(settings.fontSize);
  const lineHeight = finiteNumber(settings.lineHeight);
  const paragraphSpacing = finiteNumber(settings.paragraphSpacing);
  const paragraphIndent = finiteNumber(settings.paragraphIndent);
  const maxTextWidth = finiteNumber(settings.maxTextWidth);

  if (backgroundColor !== undefined) sanitized.backgroundColor = backgroundColor;
  if (textColor !== undefined) sanitized.textColor = textColor;
  if (linkColor !== undefined) sanitized.linkColor = linkColor;
  if (fontFamily !== undefined) sanitized.fontFamily = fontFamily;
  if (fontSize !== undefined) sanitized.fontSize = fontSize;
  if (lineHeight !== undefined) sanitized.lineHeight = lineHeight;
  if (paragraphSpacing !== undefined) sanitized.paragraphSpacing = paragraphSpacing;
  if (paragraphIndent !== undefined) sanitized.paragraphIndent = paragraphIndent;
  if (maxTextWidth !== undefined) sanitized.maxTextWidth = maxTextWidth;

  return sanitized;
}

export function getLanguagePreference() {
  const language = readPreferences().language;

  return isLanguage(language) ? language : undefined;
}

export function setLanguagePreference(language: Language) {
  updatePreferences((preferences) => ({ ...preferences, language }));
}

export function getThemePreference(): ThemeId | undefined {
  const theme = readPreferences().theme;

  return isThemeId(theme) ? theme : undefined;
}

export function setThemePreference(theme: ThemeId) {
  updatePreferences((preferences) => ({ ...preferences, theme }));
}

export function getLibraryViewPreference(): LibraryView | undefined {
  const view = readPreferences().libraryView;

  return isLibraryView(view) ? view : undefined;
}

export function setLibraryViewPreference(view: LibraryView) {
  updatePreferences((preferences) => ({ ...preferences, libraryView: view }));
}

export function getRecentTagsPreference() {
  const recentTags = readPreferences().recentTags;

  if (!isStringArray(recentTags)) {
    return [];
  }

  return recentTags.filter((tag) => tag.trim().length > 0);
}

export function setRecentTagsPreference(recentTags: string[]) {
  updatePreferences((preferences) => ({
    ...preferences,
    recentTags: recentTags.filter((tag) => tag.trim().length > 0),
  }));
}

export function getFb2ReaderSettingsPreference() {
  const settings = readReaderPreferences()?.fb2?.settings;

  return sanitizeFb2ReaderSettings(settings);
}

export function setFb2ReaderSettingsPreference(settings: Fb2ReaderSettings) {
  updatePreferences((preferences) => ({
    ...preferences,
    readers: {
      ...readerPreferencesForWrite(preferences),
      fb2: { settings },
    },
  }));
}

export function getPdfReaderContentWidthPreference() {
  const contentWidth = readReaderPreferences()?.pdf?.contentWidth;

  return finiteNumber(contentWidth);
}

export function setPdfReaderContentWidthPreference(contentWidth: number | undefined) {
  updatePreferences((preferences) => ({
    ...preferences,
    readers: {
      ...readerPreferencesForWrite(preferences),
      pdf: {
        ...pdfReaderPreferencesForWrite(preferences),
        ...(contentWidth === undefined ? { contentWidth: undefined } : { contentWidth }),
      },
    },
  }));
}

export function getPdfReaderPageWidthOverflowPreference(bookId: string) {
  const pageWidthOverflows = readReaderPreferences()?.pdf?.pageWidthOverflows;

  if (!isRecord(pageWidthOverflows)) {
    return defaultPdfPageWidthOverflow;
  }

  const pageWidthOverflow = finiteNumber(pageWidthOverflows[bookId]);

  return pageWidthOverflow === undefined
    ? defaultPdfPageWidthOverflow
    : clampPdfPageWidthOverflow(pageWidthOverflow);
}

export function setPdfReaderPageWidthOverflowPreference(bookId: string, pageWidthOverflow: number) {
  updatePreferences((preferences) => {
    const currentPageWidthOverflows = pdfReaderPreferencesForWrite(preferences)?.pageWidthOverflows;
    const pageWidthOverflows = isRecord(currentPageWidthOverflows) ? currentPageWidthOverflows : {};

    return {
      ...preferences,
      readers: {
        ...readerPreferencesForWrite(preferences),
        pdf: {
          ...pdfReaderPreferencesForWrite(preferences),
          pageWidthOverflows: {
            ...pageWidthOverflows,
            [bookId]: clampPdfPageWidthOverflow(pageWidthOverflow),
          },
        },
      },
    };
  });
}

export function getPdfReaderHorizontalScrollPositionPreference(bookId: string) {
  const horizontalScrollPositions = readReaderPreferences()?.pdf?.horizontalScrollPositions;

  return isRecord(horizontalScrollPositions)
    ? unitIntervalNumber(horizontalScrollPositions[bookId])
    : undefined;
}

export function setPdfReaderHorizontalScrollPositionPreference(
  bookId: string,
  position: number | undefined,
) {
  updatePreferences((preferences) => {
    const currentPositions = pdfReaderPreferencesForWrite(preferences)?.horizontalScrollPositions;
    const horizontalScrollPositions = isRecord(currentPositions) ? currentPositions : {};
    const nextPositions = { ...horizontalScrollPositions };

    if (position === undefined) {
      delete nextPositions[bookId];
    } else {
      nextPositions[bookId] = Math.min(1, Math.max(0, position));
    }

    return {
      ...preferences,
      readers: {
        ...readerPreferencesForWrite(preferences),
        pdf: {
          ...pdfReaderPreferencesForWrite(preferences),
          horizontalScrollPositions: nextPositions,
        },
      },
    };
  });
}

export function getPdfReaderFilterChainPreference(bookId: string) {
  const filterChains = readReaderPreferences()?.pdf?.filterChains;

  if (!isRecord(filterChains)) {
    return undefined;
  }

  return sanitizePdfFilterChain(filterChains[bookId]);
}

export function setPdfReaderFilterChainPreference(bookId: string, chain: PdfFilterChain) {
  updatePreferences((preferences) => {
    const currentFilterChains = pdfReaderPreferencesForWrite(preferences)?.filterChains;
    const filterChains = isRecord(currentFilterChains) ? currentFilterChains : {};

    return {
      ...preferences,
      readers: {
        ...readerPreferencesForWrite(preferences),
        pdf: {
          ...pdfReaderPreferencesForWrite(preferences),
          filterChains: {
            ...filterChains,
            [bookId]: chain,
          },
        },
      },
    };
  });
}
