import { AlignLeft, Palette, RotateCcw, SlidersHorizontal, Type } from 'lucide-solid';
import { For } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { useI18n } from '@/i18n/I18nProvider';
import { fontOptions } from '../reflowableReaderSettings';
import type { ReflowableReaderSettings } from '../reflowableTypes';
import styles from './SettingsPanel.module.scss';

type UpdateSetting = <T extends keyof ReflowableReaderSettings>(
  key: T,
  value: ReflowableReaderSettings[T],
  keepLockedAnchor?: boolean,
) => void;

function SettingsPanel(props: {
  open: boolean;
  settings: ReflowableReaderSettings;
  onClose: () => void;
  onReset: () => void;
  onUpdateSetting: UpdateSetting;
  onAutoWidth: () => void;
  onBeginAdjustLayout: () => void;
  onEndAdjustLayout: () => void;
}) {
  const { t } = useI18n();

  const captureLayoutAdjust = (event: PointerEvent) => {
    (event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId);
    props.onBeginAdjustLayout();
  };

  return (
    <ReaderSidePanel
      open={props.open}
      title={t('readerAppearance')}
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
            {t('reset')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            type="button"
            iconStart={<SlidersHorizontal />}
            onClick={props.onAutoWidth}
          >
            {t('autoWidth')}
          </Button>
        </div>
      }
    >
      <section class={styles.settingGroup}>
        <h3>
          <Type size={17} />
          {t('text')}
        </h3>
        <InputContainer label={t('font')}>
          <select
            value={props.settings.fontFamily}
            onInput={(event) => props.onUpdateSetting('fontFamily', event.currentTarget.value)}
          >
            <For each={fontOptions}>
              {(font) => <option value={font.value}>{font.label}</option>}
            </For>
          </select>
        </InputContainer>
        <InputContainer label={t('size')} labelEnd={`${props.settings.fontSize}px`}>
          <input
            type="range"
            min="14"
            max="60"
            value={props.settings.fontSize}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={() => props.onEndAdjustLayout()}
            onPointerCancel={() => props.onEndAdjustLayout()}
            onInput={(event) =>
              props.onUpdateSetting('fontSize', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer label={t('lineHeight')} labelEnd={props.settings.lineHeight.toFixed(2)}>
          <input
            type="range"
            min="1.2"
            max="2.2"
            step="0.02"
            value={props.settings.lineHeight}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={() => props.onEndAdjustLayout()}
            onPointerCancel={() => props.onEndAdjustLayout()}
            onInput={(event) =>
              props.onUpdateSetting('lineHeight', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <AlignLeft size={17} />
          {t('paragraphs')}
        </h3>
        <InputContainer
          label={t('firstLineIndent')}
          labelEnd={`${props.settings.paragraphIndent}px`}
        >
          <input
            type="range"
            min="0"
            max="64"
            value={props.settings.paragraphIndent}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={() => props.onEndAdjustLayout()}
            onPointerCancel={() => props.onEndAdjustLayout()}
            onInput={(event) =>
              props.onUpdateSetting('paragraphIndent', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer
          label={t('paragraphSpacing')}
          labelEnd={`${props.settings.paragraphSpacing}px`}
        >
          <input
            type="range"
            min="4"
            max="36"
            value={props.settings.paragraphSpacing}
            onPointerDown={captureLayoutAdjust}
            onPointerUp={() => props.onEndAdjustLayout()}
            onPointerCancel={() => props.onEndAdjustLayout()}
            onInput={(event) =>
              props.onUpdateSetting('paragraphSpacing', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <Palette size={17} />
          {t('colors')}
        </h3>
        <InputContainer label={t('background')}>
          <input
            type="color"
            value={props.settings.backgroundColor}
            onInput={(event) => props.onUpdateSetting('backgroundColor', event.currentTarget.value)}
          />
        </InputContainer>
        <InputContainer label={t('text')}>
          <input
            type="color"
            value={props.settings.textColor}
            onInput={(event) => props.onUpdateSetting('textColor', event.currentTarget.value)}
          />
        </InputContainer>
        <InputContainer label={t('links')}>
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
