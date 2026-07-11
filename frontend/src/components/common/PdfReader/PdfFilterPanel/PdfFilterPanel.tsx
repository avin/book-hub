import { RotateCcw } from 'lucide-solid';
import { createEffect, createSignal, Show, untrack } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { useI18n } from '@/i18n/I18nProvider';
import type { PdfInvertFilter } from '../pdfFilters';
import styles from './PdfFilterPanel.module.scss';

function PdfFilterPanel(props: {
  open: boolean;
  filter: PdfInvertFilter;
  available: boolean;
  unavailableMessage?: string;
  onClose: () => void;
  onToggleInvert: (enabled: boolean) => void;
  onStrengthChange: (strength: number) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [draftStrength, setDraftStrength] = createSignal(untrack(() => props.filter.strength));

  createEffect(() => {
    setDraftStrength(props.filter.strength);
  });

  const commitStrength = () => {
    props.onStrengthChange(draftStrength());
  };

  const capturePointer = (event: PointerEvent) => {
    (event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId);
  };

  return (
    <ReaderSidePanel
      open={props.open}
      title={t('pdfFilters')}
      onClose={props.onClose}
      footer={
        <Button
          fullWidth
          variant="secondary"
          type="button"
          iconStart={<RotateCcw />}
          onClick={props.onReset}
        >
          {t('resetAll')}
        </Button>
      }
    >
      <section class={styles.filterGroup}>
        <label class={styles.filterToggle}>
          <input
            type="checkbox"
            checked={props.filter.enabled}
            disabled={!props.available}
            onChange={(event) => props.onToggleInvert(event.currentTarget.checked)}
          />
          <span>{t('invert')}</span>
        </label>

        <Show when={props.filter.enabled && props.available}>
          <InputContainer
            label={t('filterStrength')}
            labelEnd={`${Math.round(draftStrength() * 100)}%`}
          >
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={draftStrength()}
              aria-label={t('filterStrength')}
              onPointerDown={capturePointer}
              onPointerUp={commitStrength}
              onPointerCancel={commitStrength}
              onInput={(event) => setDraftStrength(Number(event.currentTarget.value))}
            />
          </InputContainer>
        </Show>

        <Show when={props.unavailableMessage}>
          <p class={styles.unavailableMessage} role="alert">
            {props.unavailableMessage}
          </p>
        </Show>
      </section>
    </ReaderSidePanel>
  );
}

export default PdfFilterPanel;
