import { createMemo, For } from 'solid-js';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages';
import { themes, type ThemeId } from '@/styles/themes';
import styles from './ThemeSelect.module.scss';

const labelKey: Record<ThemeId, MessageKey> = {
  'light-clay': 'themeLightClay',
  'light-sand': 'themeLightSand',
  'light-mint': 'themeLightMint',
  'dark-ink': 'themeDarkInk',
  'dark-green': 'themeDarkGreen',
  'dark-graphite': 'themeDarkGraphite',
  'dark-ocean': 'themeDarkOcean',
  'dark-amethyst': 'themeDarkAmethyst',
};

function Swatch(props: { themeId: ThemeId }) {
  return (
    <div class={styles.swatch} data-theme={props.themeId}>
      <div class={styles.swatchSurface}>
        <div class={styles.swatchRail} />
        <div class={styles.swatchBody}>
          <span class={styles.swatchTitle} />
          <span class={styles.swatchText} />
        </div>
        <span class={styles.swatchAccent} />
      </div>
      <span class={styles.swatchBar} />
    </div>
  );
}

function ThemeSelect(props: { value: ThemeId; onChange: (themeId: ThemeId) => void }) {
  const { t } = useI18n();
  const orderedThemes = createMemo(() => [...themes].sort((a, b) => a.order - b.order));

  return (
    <div class={styles.themeGrid} role="radiogroup" aria-label={t('theme')}>
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
