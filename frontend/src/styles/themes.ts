// Theme application runtime.
//
// Themes are palettes defined in _themes.scss as [data-theme="..."] blocks.
// The active theme is stored in browserPreferences (localStorage) and applied
// by setting the data-theme attribute on <html>. An inline script in
// index.html applies the stored/preferred theme before first paint to avoid
// a flash of the wrong theme (FOUC). This module owns the canonical list and
// the post-hydration sync.
//
export const themes = [
  { id: 'light-clay', kind: 'light', order: 0 },
  { id: 'light-slate', kind: 'light', order: 1 },
  { id: 'light-sage', kind: 'light', order: 2 },
  { id: 'light-peach', kind: 'light', order: 3 },
  { id: 'light-sand', kind: 'light', order: 4 },
  { id: 'light-mint', kind: 'light', order: 5 },
  { id: 'dark-ink', kind: 'dark', order: 6 },
  { id: 'dark-green', kind: 'dark', order: 7 },
  { id: 'dark-graphite', kind: 'dark', order: 8 },
  { id: 'dark-ocean', kind: 'dark', order: 9 },
  { id: 'dark-amethyst', kind: 'dark', order: 10 },
] as const;

export type ThemeId = (typeof themes)[number]['id'];
export type ThemeKind = 'light' | 'dark';

export const themeIds = themes.map((theme) => theme.id);

const themeIdSet = new Set<string>(themeIds);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && themeIdSet.has(value);
}

export function defaultThemeId(): ThemeId {
  // Mirrors the FOUC script in index.html: first visit defaults to the user's
  // OS/browser color-scheme preference.
  return prefersDark() ? 'dark-ink' : 'light-clay';
}

function prefersDark() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

export function applyTheme(themeId: ThemeId) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', themeId);
  }
}
