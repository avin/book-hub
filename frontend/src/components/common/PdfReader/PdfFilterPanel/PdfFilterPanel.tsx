import { RotateCcw } from 'lucide-solid';
import { createEffect, createSignal, Show, untrack } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { useI18n } from '@/i18n/I18nProvider';
import {
  pdfTextEnhancementRanges,
  type PdfInvertFilter,
  type PdfTextEnhancementFilter,
} from '../pdfFilters';
import styles from './PdfFilterPanel.module.scss';

function PdfFilterPanel(props: {
  open: boolean;
  textEnhancementFilter: PdfTextEnhancementFilter;
  invertFilter: PdfInvertFilter;
  available: boolean;
  unavailableMessage?: string;
  onClose: () => void;
  onToggleTextEnhancement: (enabled: boolean) => void;
  onTextEnhancementParameterChange: (
    parameter: keyof Omit<PdfTextEnhancementFilter, 'id' | 'enabled'>,
    value: number,
  ) => void;
  onToggleInvert: (enabled: boolean) => void;
  onStrengthChange: (strength: number) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [draftStrokeWidth, setDraftStrokeWidth] = createSignal(
    untrack(() => props.textEnhancementFilter.strokeWidth),
  );
  const [draftThreshold, setDraftThreshold] = createSignal(
    untrack(() => props.textEnhancementFilter.threshold),
  );
  const [draftContrast, setDraftContrast] = createSignal(
    untrack(() => props.textEnhancementFilter.contrast),
  );
  const [draftGrayLevels, setDraftGrayLevels] = createSignal(
    untrack(() => props.textEnhancementFilter.grayLevels),
  );
  const [draftToneShift, setDraftToneShift] = createSignal(
    untrack(() => props.textEnhancementFilter.toneShift),
  );
  const [draftStrength, setDraftStrength] = createSignal(
    untrack(() => props.invertFilter.strength),
  );

  createEffect(() => {
    const filter = props.textEnhancementFilter;
    setDraftStrokeWidth(filter.strokeWidth);
    setDraftThreshold(filter.threshold);
    setDraftContrast(filter.contrast);
    setDraftGrayLevels(filter.grayLevels);
    setDraftToneShift(filter.toneShift);
  });

  createEffect(() => {
    setDraftStrength(props.invertFilter.strength);
  });

  const commitTextEnhancementParameter = (
    parameter: keyof Omit<PdfTextEnhancementFilter, 'id' | 'enabled'>,
    value: number,
  ) => {
    props.onTextEnhancementParameterChange(parameter, value);
  };

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
            checked={props.textEnhancementFilter.enabled}
            disabled={!props.available}
            onChange={(event) => props.onToggleTextEnhancement(event.currentTarget.checked)}
          />
          <span>{t('textEnhancement')}</span>
        </label>

        <Show when={props.textEnhancementFilter.enabled && props.available}>
          <InputContainer label={t('strokeWidth')} labelEnd={draftStrokeWidth().toFixed(2)}>
            <input
              type="range"
              min={pdfTextEnhancementRanges.strokeWidth.min}
              max={pdfTextEnhancementRanges.strokeWidth.max}
              step={pdfTextEnhancementRanges.strokeWidth.step}
              value={draftStrokeWidth()}
              aria-label={t('strokeWidth')}
              onPointerDown={capturePointer}
              onPointerUp={() => commitTextEnhancementParameter('strokeWidth', draftStrokeWidth())}
              onPointerCancel={() =>
                commitTextEnhancementParameter('strokeWidth', draftStrokeWidth())
              }
              onInput={(event) => setDraftStrokeWidth(Number(event.currentTarget.value))}
            />
          </InputContainer>

          <InputContainer label={t('threshold')} labelEnd={draftThreshold().toFixed(2)}>
            <input
              type="range"
              min={pdfTextEnhancementRanges.threshold.min}
              max={pdfTextEnhancementRanges.threshold.max}
              step={pdfTextEnhancementRanges.threshold.step}
              value={draftThreshold()}
              aria-label={t('threshold')}
              onPointerDown={capturePointer}
              onPointerUp={() => commitTextEnhancementParameter('threshold', draftThreshold())}
              onPointerCancel={() => commitTextEnhancementParameter('threshold', draftThreshold())}
              onInput={(event) => setDraftThreshold(Number(event.currentTarget.value))}
            />
          </InputContainer>

          <InputContainer label={t('contrast')} labelEnd={draftContrast().toFixed(2)}>
            <input
              type="range"
              min={pdfTextEnhancementRanges.contrast.min}
              max={pdfTextEnhancementRanges.contrast.max}
              step={pdfTextEnhancementRanges.contrast.step}
              value={draftContrast()}
              aria-label={t('contrast')}
              onPointerDown={capturePointer}
              onPointerUp={() => commitTextEnhancementParameter('contrast', draftContrast())}
              onPointerCancel={() => commitTextEnhancementParameter('contrast', draftContrast())}
              onInput={(event) => setDraftContrast(Number(event.currentTarget.value))}
            />
          </InputContainer>

          <InputContainer label={t('grayLevels')} labelEnd={String(draftGrayLevels())}>
            <input
              type="range"
              min={pdfTextEnhancementRanges.grayLevels.min}
              max={pdfTextEnhancementRanges.grayLevels.max}
              step={pdfTextEnhancementRanges.grayLevels.step}
              value={draftGrayLevels()}
              aria-label={t('grayLevels')}
              onPointerDown={capturePointer}
              onPointerUp={() => commitTextEnhancementParameter('grayLevels', draftGrayLevels())}
              onPointerCancel={() =>
                commitTextEnhancementParameter('grayLevels', draftGrayLevels())
              }
              onInput={(event) => setDraftGrayLevels(Number(event.currentTarget.value))}
            />
          </InputContainer>

          <InputContainer label={t('toneShift')} labelEnd={draftToneShift().toFixed(2)}>
            <input
              type="range"
              min={pdfTextEnhancementRanges.toneShift.min}
              max={pdfTextEnhancementRanges.toneShift.max}
              step={pdfTextEnhancementRanges.toneShift.step}
              value={draftToneShift()}
              aria-label={t('toneShift')}
              onPointerDown={capturePointer}
              onPointerUp={() => commitTextEnhancementParameter('toneShift', draftToneShift())}
              onPointerCancel={() => commitTextEnhancementParameter('toneShift', draftToneShift())}
              onInput={(event) => setDraftToneShift(Number(event.currentTarget.value))}
            />
          </InputContainer>
        </Show>
      </section>

      <section class={styles.filterGroup}>
        <label class={styles.filterToggle}>
          <input
            type="checkbox"
            checked={props.invertFilter.enabled}
            disabled={!props.available}
            onChange={(event) => props.onToggleInvert(event.currentTarget.checked)}
          />
          <span>{t('invert')}</span>
        </label>

        <Show when={props.invertFilter.enabled && props.available}>
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
      </section>

      <Show when={props.unavailableMessage}>
        <p class={styles.unavailableMessage} role="alert">
          {props.unavailableMessage}
        </p>
      </Show>
    </ReaderSidePanel>
  );
}

export default PdfFilterPanel;
