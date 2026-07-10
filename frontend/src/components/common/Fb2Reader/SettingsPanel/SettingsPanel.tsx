import { AlignLeft, Palette, RotateCcw, SlidersHorizontal, Type } from 'lucide-solid';
import { For } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { fontOptions } from '../fb2ReaderSettings';
import type { Fb2ReaderSettings } from '../fb2Types';
import styles from './SettingsPanel.module.scss';

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
  onAutoWidth: () => void;
  onBeginAdjustLayout: () => void;
  onEndAdjustLayout: () => void;
}) {
  const captureLayoutAdjust = (event: PointerEvent) => {
    (event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId);
    props.onBeginAdjustLayout();
  };

  return (
    <ReaderSidePanel
      open={props.open}
      title="Внешний вид"
      onClose={props.onClose}
      footer={
        <div class={styles.panelActions}>
          <Button
            fullWidth
            variant="secondary"
            type="button"
            iconStart={<RotateCcw />}
            onClick={props.onReset}
          >
            Сбросить
          </Button>
          <Button
            fullWidth
            variant="secondary"
            type="button"
            iconStart={<SlidersHorizontal />}
            onClick={props.onAutoWidth}
          >
            Автоширина
          </Button>
        </div>
      }
    >
      <section class={styles.settingGroup}>
        <h3>
          <Type size={17} />
          Текст
        </h3>
        <InputContainer label="Шрифт">
          <select
            value={props.settings.fontFamily}
            onInput={(event) => props.onUpdateSetting('fontFamily', event.currentTarget.value)}
          >
            <For each={fontOptions}>
              {(font) => <option value={font.value}>{font.label}</option>}
            </For>
          </select>
        </InputContainer>
        <InputContainer label="Размер" labelEnd={`${props.settings.fontSize}px`}>
          <input
            type="range"
            min="14"
            max="30"
            value={props.settings.fontSize}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={props.onEndAdjustLayout}
            onPointerCancel={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('fontSize', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer label="Интерлиньяж" labelEnd={props.settings.lineHeight.toFixed(2)}>
          <input
            type="range"
            min="1.2"
            max="2.2"
            step="0.02"
            value={props.settings.lineHeight}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={props.onEndAdjustLayout}
            onPointerCancel={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('lineHeight', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <AlignLeft size={17} />
          Абзацы
        </h3>
        <InputContainer
          label="Отступ первой строки"
          labelEnd={`${props.settings.paragraphIndent}px`}
        >
          <input
            type="range"
            min="0"
            max="64"
            value={props.settings.paragraphIndent}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={props.onEndAdjustLayout}
            onPointerCancel={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('paragraphIndent', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer
          label="Отступ после абзаца"
          labelEnd={`${props.settings.paragraphSpacing}px`}
        >
          <input
            type="range"
            min="4"
            max="36"
            value={props.settings.paragraphSpacing}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={props.onEndAdjustLayout}
            onPointerCancel={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('paragraphSpacing', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <Palette size={17} />
          Цвета
        </h3>
        <InputContainer label="Фон">
          <input
            type="color"
            value={props.settings.backgroundColor}
            onInput={(event) => props.onUpdateSetting('backgroundColor', event.currentTarget.value)}
          />
        </InputContainer>
        <InputContainer label="Текст">
          <input
            type="color"
            value={props.settings.textColor}
            onInput={(event) => props.onUpdateSetting('textColor', event.currentTarget.value)}
          />
        </InputContainer>
        <InputContainer label="Ссылки">
          <input
            type="color"
            value={props.settings.linkColor}
            onInput={(event) => props.onUpdateSetting('linkColor', event.currentTarget.value)}
          />
        </InputContainer>
      </section>
    </ReaderSidePanel>
  );
}

export default SettingsPanel;
