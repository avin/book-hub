import { createMemo, For } from "solid-js";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { themes, type ThemeId } from "@/styles/themes";
import styles from "./ThemeSelect.module.scss";

// Each theme has an inline preview palette so the swatch shows that theme's
// look regardless of which theme is currently active (the CSS tokens resolve
// to the live theme, so we can't reuse them here). Mirrors _themes.scss.
const previewPalettes: Record<ThemeId, { page: string; rail: string; title: string; text: string; accent: string; bar: string }> = {
  "light-clay": { page: "#fafaf9", rail: "#f5f5f4", title: "#1c1917", text: "#78716c", accent: "#c2410c", bar: "#fb923c" },
  "light-slate": { page: "#f8fafc", rail: "#f1f5f9", title: "#0f172a", text: "#64748b", accent: "#2563eb", bar: "#60a5fa" },
  "light-sage": { page: "#f7faf7", rail: "#eef4ef", title: "#14241b", text: "#6b7a70", accent: "#16a34a", bar: "#4ade80" },
  "dark-ink": { page: "#1c1917", rail: "#292524", title: "#f5f5f4", text: "#a8a29e", accent: "#fb923c", bar: "#c2410c" },
  "dark-green": { page: "#131a16", rail: "#1d2722", title: "#ecefe9", text: "#8fa094", accent: "#4ade80", bar: "#16a34a" },
  "dark-graphite": { page: "#161616", rail: "#212121", title: "#ededed", text: "#8a8a8a", accent: "#60a5fa", bar: "#2563eb" },
};

const labelKey: Record<ThemeId, MessageKey> = {
  "light-clay": "themeLightClay",
  "light-slate": "themeLightSlate",
  "light-sage": "themeLightSage",
  "dark-ink": "themeDarkInk",
  "dark-green": "themeDarkGreen",
  "dark-graphite": "themeDarkGraphite",
};

function Swatch(props: { themeId: ThemeId }) {
  const p = previewPalettes[props.themeId];

  return (
    <div class={styles.swatch} style={{ background: p.page }}>
      <div class={styles.swatchSurface}>
        <div class={styles.swatchRail} style={{ background: p.rail }} />
        <div class={styles.swatchBody}>
          <span class={styles.swatchTitle} style={{ background: p.title }} />
          <span class={styles.swatchText} style={{ background: p.text }} />
        </div>
        <span class={styles.swatchAccent} style={{ background: p.accent }} />
      </div>
      <span class={styles.swatchBar} style={{ background: p.bar }} />
    </div>
  );
}

function ThemeSelect(props: { value: ThemeId; onChange: (themeId: ThemeId) => void }) {
  const { t } = useI18n();
  const orderedThemes = createMemo(() => [...themes].sort((a, b) => a.order - b.order));

  return (
    <div class={styles.themeGrid} role="radiogroup" aria-label={t("theme")}>
      <For each={orderedThemes()}>
        {(theme) => (
          <button
            type="button"
            class={styles.themeOption}
            classList={{ [styles.selected]: props.value === theme.id }}
            role="radio"
            aria-checked={props.value === theme.id}
            title={t(labelKey[theme.id])}
            onClick={() => props.onChange(theme.id)}
          >
            <Swatch themeId={theme.id} />
            <p class={styles.themeLabel}>{t(labelKey[theme.id])}</p>
          </button>
        )}
      </For>
    </div>
  );
}

export default ThemeSelect;
