import { onMount } from "solid-js";
import { applyTheme, defaultThemeId, type ThemeId } from "./themes";
import { getThemePreference, setThemePreference } from "@/storage/browserPreferences";

// Post-hydration theme reconciliation.
//
// The inline FOUC script in index.html already applies the theme before first
// paint. This component re-applies the stored preference once on mount to
// correct any drift between the DOM attribute and localStorage (e.g. if the
// preference changed in another tab, or the FOUC script fell back to default).
//
// Runtime theme changes go through `changeTheme`, which updates both the
// preference and the DOM attribute imperatively. Theme is a device-local
// preference (ADR: docs/adr/0001-theme-system.md), not a server profile value.
function ThemeSync() {
  onMount(() => {
    applyTheme(getThemePreference() ?? defaultThemeId());
  });

  return null;
}

export function changeTheme(themeId: ThemeId) {
  setThemePreference(themeId);
  applyTheme(themeId);
}

export default ThemeSync;
