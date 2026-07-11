import { GripVertical, RotateCcw } from 'lucide-solid';
import { createEffect, createSignal, For, Show, untrack } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { useI18n } from '@/i18n/I18nProvider';
import {
  pdfTextEnhancementRanges,
  type PdfFilter,
  type PdfFilterChain,
  type PdfInvertFilter,
  type PdfTextEnhancementFilter,
} from '../pdfFilters';
import styles from './PdfFilterPanel.module.scss';

function PdfFilterPanel(props: {
  open: boolean;
  filterChain: PdfFilterChain;
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
  onMoveFilter: (filterId: PdfFilter['id'], targetIndex: number) => void;
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
  const [draggedFilterId, setDraggedFilterId] = createSignal<PdfFilter['id']>();

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

  const filterTitle = (filter: PdfFilter) =>
    filter.id === 'textEnhancement' ? t('textEnhancement') : t('invert');

  const handleDragStart = (event: DragEvent, filterId: PdfFilter['id']) => {
    setDraggedFilterId(filterId);
    event.dataTransfer?.setData('text/plain', filterId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDrop = (event: DragEvent, targetId: PdfFilter['id']) => {
    event.preventDefault();
    const sourceId = draggedFilterId() ?? event.dataTransfer?.getData('text/plain');

    if ((sourceId !== 'textEnhancement' && sourceId !== 'invert') || sourceId === targetId) {
      setDraggedFilterId();
      return;
    }

    const targetIndex = props.filterChain.findIndex((filter) => filter.id === targetId);
    if (targetIndex >= 0) {
      props.onMoveFilter(sourceId, targetIndex);
    }

    setDraggedFilterId();
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
      <For each={props.filterChain}>
        {(filter) => (
          <section
            class={styles.filterGroup}
            classList={{ [styles.filterDragging]: draggedFilterId() === filter.id }}
            data-testid={`pdf-filter-item-${filter.id}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, filter.id)}
          >
            <div class={styles.filterHeader}>
              <Button
                variant="ghost"
                iconOnly
                type="button"
                draggable="true"
                class={styles.dragHandle}
                iconStart={<GripVertical />}
                title={`${t('moveFilter')}: ${filterTitle(filter)}`}
                aria-label={`${t('moveFilter')}: ${filterTitle(filter)}`}
                data-testid={`pdf-filter-drag-handle-${filter.id}`}
                onDragStart={(event) => handleDragStart(event, filter.id)}
                onDragEnd={() => setDraggedFilterId()}
              />
              <label class={styles.filterToggle}>
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  disabled={!props.available}
                  onChange={(event) =>
                    filter.id === 'textEnhancement'
                      ? props.onToggleTextEnhancement(event.currentTarget.checked)
                      : props.onToggleInvert(event.currentTarget.checked)
                  }
                />
                <span>{filter.id === 'textEnhancement' ? t('textEnhancement') : t('invert')}</span>
              </label>
            </div>

            <Show when={filter.id === 'textEnhancement' && filter.enabled && props.available}>
              <InputContainer label={t('strokeWidth')} labelEnd={draftStrokeWidth().toFixed(2)}>
                <input
                  type="range"
                  min={pdfTextEnhancementRanges.strokeWidth.min}
                  max={pdfTextEnhancementRanges.strokeWidth.max}
                  step={pdfTextEnhancementRanges.strokeWidth.step}
                  value={draftStrokeWidth()}
                  aria-label={t('strokeWidth')}
                  onPointerDown={capturePointer}
                  onPointerUp={() =>
                    commitTextEnhancementParameter('strokeWidth', draftStrokeWidth())
                  }
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
                  onPointerCancel={() =>
                    commitTextEnhancementParameter('threshold', draftThreshold())
                  }
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
                  onPointerCancel={() =>
                    commitTextEnhancementParameter('contrast', draftContrast())
                  }
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
                  onPointerUp={() =>
                    commitTextEnhancementParameter('grayLevels', draftGrayLevels())
                  }
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
                  onPointerCancel={() =>
                    commitTextEnhancementParameter('toneShift', draftToneShift())
                  }
                  onInput={(event) => setDraftToneShift(Number(event.currentTarget.value))}
                />
              </InputContainer>
            </Show>

            <Show when={filter.id === 'invert' && filter.enabled && props.available}>
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
        )}
      </For>

      <Show when={props.unavailableMessage}>
        <p class={styles.unavailableMessage} role="alert">
          {props.unavailableMessage}
        </p>
      </Show>
    </ReaderSidePanel>
  );
}

export default PdfFilterPanel;
