import { type Language, languages } from '@/i18n/messages';

const preferencesStorageKey = 'book-hub-preferences';
const legacyLanguageStorageKey = 'book-hub-language';
const legacyRecentTagsStorageKey = 'book-hub-tags-recent';

export type FixedLayoutReaderPreferences = {
  contentWidth?: number;
  pageWidthOverflows?: Record<string, unknown>;
  horizontalScrollPositions?: Record<string, unknown>;
  filterChains?: Record<string, unknown>;
};

export type BrowserPreferences = {
  version: 1;
  language?: unknown;
  theme?: unknown;
  libraryView?: unknown;
  recentTags?: unknown;
  readers?: {
    fb2?: { settings?: unknown };
    pdf?: FixedLayoutReaderPreferences;
    fixedLayout?: FixedLayoutReaderPreferences;
  };
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function unitIntervalNumber(value: unknown) {
  const number = finiteNumber(value);

  return number !== undefined && number >= 0 && number <= 1 ? number : undefined;
}

export function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && languages.includes(value as Language);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
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

    return { ...parsed, version: 1 } as BrowserPreferences;
  } catch {
    return { version: 1 };
  }
}

function writeRawPreferences(preferences: BrowserPreferences) {
  try {
    localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences));
    return true;
  } catch {
    // Keep storage failures non-fatal for reader and form controls.
    return false;
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
        migrated = { ...migrated, recentTags: recentTags.filter((tag) => tag.trim().length > 0) };
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

export function readPreferences() {
  return migrateLegacyPreferences(readRawPreferences());
}

export function updatePreferences(update: (preferences: BrowserPreferences) => BrowserPreferences) {
  writeRawPreferences(update(readPreferences()));
}

export function readerPreferencesForWrite(preferences: BrowserPreferences) {
  return isRecord(preferences.readers) ? preferences.readers : undefined;
}

export function fixedLayoutReaderPreferencesForWrite(preferences: BrowserPreferences) {
  const readers = preferences.readers;
  const fixedLayout = isRecord(readers) ? readers.fixedLayout : undefined;
  const legacyPdf = isRecord(readers) ? readers.pdf : undefined;

  return isRecord(fixedLayout) ? fixedLayout : isRecord(legacyPdf) ? legacyPdf : undefined;
}

export function fixedLayoutReaderPreferences() {
  const preferences = readPreferences();
  const readers = readerPreferencesForWrite(preferences);
  const fixedLayout = readers?.fixedLayout;

  if (isRecord(fixedLayout)) {
    return fixedLayout;
  }

  const legacyPdf = readers?.pdf;
  if (!isRecord(legacyPdf)) {
    return undefined;
  }

  writeRawPreferences({ ...preferences, readers: { ...readers, fixedLayout: legacyPdf } });
  return legacyPdf;
}
