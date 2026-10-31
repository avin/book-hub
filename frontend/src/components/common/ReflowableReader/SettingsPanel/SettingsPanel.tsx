import { AlignLeft, Palette, RotateCcw, SlidersHorizontal, Type } from 'lucide-solid';
import { For } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import RangeInput from '@/components/common/RangeInput/RangeInput';
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

  return (
    <ReaderSidePanel
      open={props.open}
      title={t('readerAppearance')}
      onClose={props.onClose}
      footer={
        <div class={styles.panelActions}>
          <Button
            fullWidth
            size="sm"
            variant="secondary"
            type="button"
            iconStart={<RotateCcw />}
            onClick={props.onReset}
          >
            {t('reset')}
          </Button>
          <Button
            fullWidth
            size="sm"
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
          <RangeInput
            min="14"
            max="90"
            value={props.settings.fontSize}
            aria-label={t('size')}
            onAdjustStart={props.onBeginAdjustLayout}
            onAdjustEnd={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('fontSize', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer label={t('lineHeight')} labelEnd={props.settings.lineHeight.toFixed(2)}>
          <RangeInput
            min="1.0"
            max="2.2"
            step="0.02"
            value={props.settings.lineHeight}
            aria-label={t('lineHeight')}
            onAdjustStart={props.onBeginAdjustLayout}
            onAdjustEnd={props.onEndAdjustLayout}
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
          <RangeInput
            min="0"
            max="256"
            value={props.settings.paragraphIndent}
            aria-label={t('firstLineIndent')}
            onAdjustStart={props.onBeginAdjustLayout}
            onAdjustEnd={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('paragraphIndent', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer
          label={t('paragraphSpacing')}
          labelEnd={`${props.settings.paragraphSpacing}px`}
        >
          <RangeInput
            min="4"
            max="120"
            value={props.settings.paragraphSpacing}
            aria-label={t('paragraphSpacing')}
            onAdjustStart={props.onBeginAdjustLayout}
            onAdjustEnd={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('paragraphSpacing', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
        <InputContainer label={t('sidePadding')} labelEnd={`${props.settings.sidePadding}px`}>
          <RangeInput
            min="2"
            max="32"
            step="1"
            aria-label={t('sidePadding')}
            value={props.settings.sidePadding}
            onAdjustStart={props.onBeginAdjustLayout}
            onAdjustEnd={props.onEndAdjustLayout}
            onInput={(event) =>
              props.onUpdateSetting('sidePadding', Number(event.currentTarget.value))
            }
          />
        </InputContainer>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <Palette size={17} />
          {t('colors')}
        </h3>
        <div class={styles.colorSettings}>
          <InputContainer label={t('background')}>
            <input
              type="color"
              value={props.settings.backgroundColor}
              onInput={(event) =>
                props.onUpdateSetting('backgroundColor', event.currentTarget.value)
              }
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
        </div>
      </section>
    </ReaderSidePanel>
  );
}

export default SettingsPanel;
