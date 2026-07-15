import { type Language, languages } from '@/i18n/messages';
import { type ThemeId, isThemeId } from '@/styles/themes';
import { readPreferences, updatePreferences } from './browserPreferencesCore';

export type LibraryView = 'list' | 'grid';

const libraryViewValues = new Set<LibraryView>(['list', 'grid']);

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && languages.includes(value as Language);
}

function isLibraryView(value: unknown): value is LibraryView {
  return typeof value === 'string' && libraryViewValues.has(value as LibraryView);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
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
  return isStringArray(recentTags) ? recentTags.filter((tag) => tag.trim().length > 0) : [];
}

export function setRecentTagsPreference(recentTags: string[]) {
  updatePreferences((preferences) => ({
    ...preferences,
    recentTags: recentTags.filter((tag) => tag.trim().length > 0),
  }));
}
