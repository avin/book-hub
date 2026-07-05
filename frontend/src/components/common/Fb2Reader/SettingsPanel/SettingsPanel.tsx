import { AlignLeft, Palette, RotateCcw, SlidersHorizontal, Type, X } from "lucide-solid";
import { For } from "solid-js";
import Button from "@/components/common/Button/Button";
import { fontOptions } from "../fb2ReaderSettings";
import type { Fb2ReaderSettings } from "../fb2Types";
import SettingRow from "./SettingRow/SettingRow";
import styles from "./SettingsPanel.module.scss";

type UpdateSetting = <T extends keyof Fb2ReaderSettings>(
  key: T,
  value: Fb2ReaderSettings[T],
  keepLockedAnchor?: boolean,
) => void;

function SettingsPanel(props: {
  open: boolean;
  settings: Fb2ReaderSettings;
  onClose: () => void;
  onReset: () => void;
  onUpdateSetting: UpdateSetting;
}) {
  return (
    <aside class={styles.settingsPanel} classList={{ [styles.panelOpen]: props.open }}>
      <div class={styles.panelHeader}>
        <h2>Внешний вид</h2>
        <Button variant="secondary" type="button" iconOnly iconStart={<X />} title="Закрыть" aria-label="Закрыть" onClick={props.onClose} />
      </div>

      <section class={styles.settingGroup}>
        <h3>
          <Type size={17} />
          Текст
        </h3>
        <SettingRow label="Шрифт">
          <select value={props.settings.fontFamily} onInput={(event) => props.onUpdateSetting("fontFamily", event.currentTarget.value)}>
            <For each={fontOptions}>{(font) => <option value={font.value}>{font.label}</option>}</For>
          </select>
        </SettingRow>
        <SettingRow label="Размер" value={`${props.settings.fontSize}px`}>
          <input
            type="range"
            min="14"
            max="30"
            value={props.settings.fontSize}
            onInput={(event) => props.onUpdateSetting("fontSize", Number(event.currentTarget.value))}
          />
        </SettingRow>
        <SettingRow label="Интерлиньяж" value={props.settings.lineHeight.toFixed(2)}>
          <input
            type="range"
            min="1.2"
            max="2.2"
            step="0.02"
            value={props.settings.lineHeight}
            onInput={(event) => props.onUpdateSetting("lineHeight", Number(event.currentTarget.value))}
          />
        </SettingRow>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <AlignLeft size={17} />
          Абзацы
        </h3>
        <SettingRow label="Отступ первой строки" value={`${props.settings.paragraphIndent}px`}>
          <input
            type="range"
            min="0"
            max="64"
            value={props.settings.paragraphIndent}
            onInput={(event) => props.onUpdateSetting("paragraphIndent", Number(event.currentTarget.value))}
          />
        </SettingRow>
        <SettingRow label="Отступ после абзаца" value={`${props.settings.paragraphSpacing}px`}>
          <input
            type="range"
            min="4"
            max="36"
            value={props.settings.paragraphSpacing}
            onInput={(event) => props.onUpdateSetting("paragraphSpacing", Number(event.currentTarget.value))}
          />
        </SettingRow>
        <SettingRow label="Поля документа" value={`${props.settings.pagePadding}px`}>
          <input
            type="range"
            min="20"
            max="120"
            value={props.settings.pagePadding}
            onInput={(event) => props.onUpdateSetting("pagePadding", Number(event.currentTarget.value))}
          />
        </SettingRow>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <Palette size={17} />
          Цвета
        </h3>
        <SettingRow label="Фон">
          <input
            type="color"
            value={props.settings.backgroundColor}
            onInput={(event) => props.onUpdateSetting("backgroundColor", event.currentTarget.value)}
          />
        </SettingRow>
        <SettingRow label="Текст">
          <input
            type="color"
            value={props.settings.textColor}
            onInput={(event) => props.onUpdateSetting("textColor", event.currentTarget.value)}
          />
        </SettingRow>
        <SettingRow label="Ссылки">
          <input
            type="color"
            value={props.settings.linkColor}
            onInput={(event) => props.onUpdateSetting("linkColor", event.currentTarget.value)}
          />
        </SettingRow>
      </section>

      <div class={styles.panelActions}>
        <Button class={styles.panelActionButton} variant="secondary" type="button" iconStart={<RotateCcw />} onClick={props.onReset}>
          Сбросить
        </Button>
        <Button
          class={styles.panelActionButton}
          variant="secondary"
          type="button"
          iconStart={<SlidersHorizontal />}
          onClick={() => props.onUpdateSetting("maxTextWidth", undefined)}
        >
          Автоширина
        </Button>
      </div>
    </aside>
  );
}

export default SettingsPanel;
