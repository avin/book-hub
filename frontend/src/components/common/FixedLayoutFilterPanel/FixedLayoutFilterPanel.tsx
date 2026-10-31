import { FileText, GripVertical, RotateCcw, SlidersHorizontal } from 'lucide-solid';
import Sortable from 'sortablejs';
import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import RangeInput from '@/components/common/RangeInput/RangeInput';
import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { useI18n } from '@/i18n/I18nProvider';
import {
  pdfSoftTextEnhancementRanges,
  pdfTextEnhancementRanges,
  pdfVisualAdjustmentRanges,
  type PdfFilter,
  type PdfFilterChain,
  type PdfGrayscaleFilter,
  type PdfInvertFilter,
  type PdfSoftTextEnhancementFilter,
  type PdfTextEnhancementFilter,
  type PdfVisualAdjustmentFilter,
  type PdfWarmthFilter,
} from '../FixedLayoutReader/fixedLayoutFilters';
import { fixedLayoutPageWidthOverflowRange } from '../FixedLayoutReader/fixedLayoutPageSettings';
import styles from './FixedLayoutFilterPanel.module.scss';

function isPdfFilterId(value: string | null): value is PdfFilter['id'] {
  return [
    'textEnhancement',
    'softTextEnhancement',
    'invert',
    'visualAdjustment',
    'warmth',
    'grayscale',
  ].includes(value ?? '');
}

function FixedLayoutFilterPanel(props: {
  open: boolean;
  filterChain: PdfFilterChain;
  textEnhancementFilter: PdfTextEnhancementFilter;
  softTextEnhancementFilter: PdfSoftTextEnhancementFilter;
  invertFilter: PdfInvertFilter;
  visualAdjustmentFilter: PdfVisualAdjustmentFilter;
  warmthFilter: PdfWarmthFilter;
  grayscaleFilter: PdfGrayscaleFilter;
  pageWidthOverflow: number;
  available: boolean;
  unavailableMessage?: string;
  onClose: () => void;
  onToggleTextEnhancement: (enabled: boolean) => void;
  onTextEnhancementParameterChange: (
    parameter: keyof Omit<PdfTextEnhancementFilter, 'id' | 'enabled'>,
    value: number,
  ) => void;
  onToggleSoftTextEnhancement: (enabled: boolean) => void;
  onSoftTextEnhancementParameterChange: (
    parameter: keyof Omit<PdfSoftTextEnhancementFilter, 'id' | 'enabled'>,
    value: number,
  ) => void;
  onToggleInvert: (enabled: boolean) => void;
  onStrengthChange: (strength: number) => void;
  onToggleVisualAdjustment: (enabled: boolean) => void;
  onVisualAdjustmentParameterChange: (
    parameter: keyof Omit<PdfVisualAdjustmentFilter, 'id' | 'enabled'>,
    value: number,
  ) => void;
  onToggleWarmth: (enabled: boolean) => void;
  onWarmthStrengthChange: (strength: number) => void;
  onToggleGrayscale: (enabled: boolean) => void;
  onGrayscaleStrengthChange: (strength: number) => void;
  onMoveFilter: (filterId: PdfFilter['id'], targetIndex: number) => void;
  onPageWidthOverflowChange: (value: number) => void;
  onReset: () => void;
  onAutoWidth: () => void;
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
  const [draftSoftStrokeWidth, setDraftSoftStrokeWidth] = createSignal(
    untrack(() => props.softTextEnhancementFilter.strokeWidth),
  );
  const [draftSoftStrength, setDraftSoftStrength] = createSignal(
    untrack(() => props.softTextEnhancementFilter.strength),
  );
  const [draftStrength, setDraftStrength] = createSignal(
    untrack(() => props.invertFilter.strength),
  );
  const [draftBrightness, setDraftBrightness] = createSignal(
    untrack(() => props.visualAdjustmentFilter.brightness),
  );
  const [draftVisualContrast, setDraftVisualContrast] = createSignal(
    untrack(() => props.visualAdjustmentFilter.contrast),
  );
  const [draftGamma, setDraftGamma] = createSignal(
    untrack(() => props.visualAdjustmentFilter.gamma),
  );
  const [draftWarmthStrength, setDraftWarmthStrength] = createSignal(
    untrack(() => props.warmthFilter.strength),
  );
  const [draftGrayscaleStrength, setDraftGrayscaleStrength] = createSignal(
    untrack(() => props.grayscaleFilter.strength),
  );
  const [draftPageWidthOverflow, setDraftPageWidthOverflow] = createSignal(
    untrack(() => props.pageWidthOverflow),
  );
  let filterListElement: HTMLDivElement | undefined;
  createEffect(() => {
    const filter = props.textEnhancementFilter;
    setDraftStrokeWidth(filter.strokeWidth);
    setDraftThreshold(filter.threshold);
    setDraftContrast(filter.contrast);
    setDraftGrayLevels(filter.grayLevels);
    setDraftToneShift(filter.toneShift);
  });

  createEffect(() => {
    const filter = props.softTextEnhancementFilter;
    setDraftSoftStrokeWidth(filter.strokeWidth);
    setDraftSoftStrength(filter.strength);
  });

  createEffect(() => {
    setDraftStrength(props.invertFilter.strength);
  });

  createEffect(() => {
    const filter = props.visualAdjustmentFilter;
    setDraftBrightness(filter.brightness);
    setDraftVisualContrast(filter.contrast);
    setDraftGamma(filter.gamma);
  });

  createEffect(() => {
    setDraftWarmthStrength(props.warmthFilter.strength);
    setDraftGrayscaleStrength(props.grayscaleFilter.strength);
  });

  createEffect(() => {
    setDraftPageWidthOverflow(props.pageWidthOverflow);
  });

  const commitTextEnhancementParameter = (
    parameter: keyof Omit<PdfTextEnhancementFilter, 'id' | 'enabled'>,
    value: number,
  ) => {
    props.onTextEnhancementParameterChange(parameter, value);
  };

  const commitSoftTextEnhancementParameter = (
    parameter: keyof Omit<PdfSoftTextEnhancementFilter, 'id' | 'enabled'>,
    value: number,
  ) => {
    props.onSoftTextEnhancementParameterChange(parameter, value);
  };

  const commitStrength = () => {
    props.onStrengthChange(draftStrength());
  };

  const commitPageWidthOverflow = () => {
    props.onPageWidthOverflowChange(draftPageWidthOverflow());
  };

  const commitVisualAdjustmentParameter = (
    parameter: keyof Omit<PdfVisualAdjustmentFilter, 'id' | 'enabled'>,
    value: number,
  ) => {
    props.onVisualAdjustmentParameterChange(parameter, value);
  };

  const filterTitle = (filter: PdfFilter) => {
    switch (filter.id) {
      case 'textEnhancement':
        return t('textEnhancement');
      case 'softTextEnhancement':
        return t('softTextEnhancement');
      case 'invert':
        return t('invert');
      case 'visualAdjustment':
        return t('visualAdjustment');
      case 'warmth':
        return t('warmth');
      case 'grayscale':
        return t('grayscale');
    }
  };

  onMount(() => {
    if (!filterListElement) {
      return;
    }

    const sortable = Sortable.create(filterListElement, {
      animation: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      handle: '[data-testid^="pdf-filter-drag-handle-"]',
      draggable: `.${styles.filterGroup}`,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      ghostClass: styles.filterPlaceholder,
      onEnd: ({ item, from, oldIndex, newIndex }) => {
        const filterId = item.getAttribute('data-filter-id');
        if (
          oldIndex === undefined ||
          newIndex === undefined ||
          oldIndex === newIndex ||
          !isPdfFilterId(filterId)
        ) {
          return;
        }

        // Restore the DOM expected by Solid before its keyed list applies the new order.
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        props.onMoveFilter(filterId, newIndex);
      },
    });

    onCleanup(() => sortable.destroy());
  });

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
          <FileText size={17} />
          {t('page')}
        </h3>
        <InputContainer
          size="sm"
          label={t('pageWidthIncrease')}
          labelEnd={`${draftPageWidthOverflow()}%`}
        >
          <RangeInput
            min={fixedLayoutPageWidthOverflowRange.min}
            max={fixedLayoutPageWidthOverflowRange.max}
            step={fixedLayoutPageWidthOverflowRange.step}
            value={draftPageWidthOverflow()}
            aria-label={t('pageWidthIncrease')}
            onChange={commitPageWidthOverflow}
            onInput={(event) => setDraftPageWidthOverflow(Number(event.currentTarget.value))}
          />
        </InputContainer>
      </section>

      <section class={styles.settingGroup}>
        <h3>
          <SlidersHorizontal size={17} />
          {t('filters')}
        </h3>
        <div ref={(element) => (filterListElement = element)} class={styles.filterList}>
          <For each={props.filterChain}>
            {(filter) => (
              <section
                class={styles.filterGroup}
                data-filter-id={filter.id}
                data-testid={`pdf-filter-item-${filter.id}`}
              >
                <div class={styles.filterHeader}>
                  <span class={styles.dragHandleWrapper}>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      type="button"
                      class={styles.dragHandle}
                      iconStart={<GripVertical />}
                      title={`${t('moveFilter')}: ${filterTitle(filter)}`}
                      aria-label={`${t('moveFilter')}: ${filterTitle(filter)}`}
                      data-testid={`pdf-filter-drag-handle-${filter.id}`}
                    />
                  </span>
                  <label class={styles.filterToggle}>
                    <input
                      type="checkbox"
                      checked={filter.enabled}
                      disabled={!props.available}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        switch (filter.id) {
                          case 'textEnhancement':
                            props.onToggleTextEnhancement(enabled);
                            break;
                          case 'softTextEnhancement':
                            props.onToggleSoftTextEnhancement(enabled);
                            break;
                          case 'invert':
                            props.onToggleInvert(enabled);
                            break;
                          case 'visualAdjustment':
                            props.onToggleVisualAdjustment(enabled);
                            break;
                          case 'warmth':
                            props.onToggleWarmth(enabled);
                            break;
                          case 'grayscale':
                            props.onToggleGrayscale(enabled);
                            break;
                        }
                      }}
                    />
                    <span>{filterTitle(filter)}</span>
                  </label>
                </div>

                <Show when={filter.id === 'textEnhancement' && filter.enabled && props.available}>
                  <InputContainer
                    size="sm"
                    label={t('strokeWidth')}
                    labelEnd={draftStrokeWidth().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfTextEnhancementRanges.strokeWidth.min}
                      max={pdfTextEnhancementRanges.strokeWidth.max}
                      step={pdfTextEnhancementRanges.strokeWidth.step}
                      value={draftStrokeWidth()}
                      aria-label={t('strokeWidth')}
                      onChange={() =>
                        commitTextEnhancementParameter('strokeWidth', draftStrokeWidth())
                      }
                      onInput={(event) => setDraftStrokeWidth(Number(event.currentTarget.value))}
                    />
                  </InputContainer>

                  <InputContainer
                    size="sm"
                    label={t('threshold')}
                    labelEnd={draftThreshold().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfTextEnhancementRanges.threshold.min}
                      max={pdfTextEnhancementRanges.threshold.max}
                      step={pdfTextEnhancementRanges.threshold.step}
                      value={draftThreshold()}
                      aria-label={t('threshold')}
                      onChange={() => commitTextEnhancementParameter('threshold', draftThreshold())}
                      onInput={(event) => setDraftThreshold(Number(event.currentTarget.value))}
                    />
                  </InputContainer>

                  <InputContainer
                    size="sm"
                    label={t('contrast')}
                    labelEnd={draftContrast().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfTextEnhancementRanges.contrast.min}
                      max={pdfTextEnhancementRanges.contrast.max}
                      step={pdfTextEnhancementRanges.contrast.step}
                      value={draftContrast()}
                      aria-label={t('contrast')}
                      onChange={() => commitTextEnhancementParameter('contrast', draftContrast())}
                      onInput={(event) => setDraftContrast(Number(event.currentTarget.value))}
                    />
                  </InputContainer>

                  <InputContainer
                    size="sm"
                    label={t('grayLevels')}
                    labelEnd={String(draftGrayLevels())}
                  >
                    <RangeInput
                      min={pdfTextEnhancementRanges.grayLevels.min}
                      max={pdfTextEnhancementRanges.grayLevels.max}
                      step={pdfTextEnhancementRanges.grayLevels.step}
                      value={draftGrayLevels()}
                      aria-label={t('grayLevels')}
                      onChange={() =>
                        commitTextEnhancementParameter('grayLevels', draftGrayLevels())
                      }
                      onInput={(event) => setDraftGrayLevels(Number(event.currentTarget.value))}
                    />
                  </InputContainer>

                  <InputContainer
                    size="sm"
                    label={t('toneShift')}
                    labelEnd={draftToneShift().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfTextEnhancementRanges.toneShift.min}
                      max={pdfTextEnhancementRanges.toneShift.max}
                      step={pdfTextEnhancementRanges.toneShift.step}
                      value={draftToneShift()}
                      aria-label={t('toneShift')}
                      onChange={() => commitTextEnhancementParameter('toneShift', draftToneShift())}
                      onInput={(event) => setDraftToneShift(Number(event.currentTarget.value))}
                    />
                  </InputContainer>
                </Show>

                <Show
                  when={filter.id === 'softTextEnhancement' && filter.enabled && props.available}
                >
                  <InputContainer
                    size="sm"
                    label={t('strokeWidth')}
                    labelEnd={draftSoftStrokeWidth().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfSoftTextEnhancementRanges.strokeWidth.min}
                      max={pdfSoftTextEnhancementRanges.strokeWidth.max}
                      step={pdfSoftTextEnhancementRanges.strokeWidth.step}
                      value={draftSoftStrokeWidth()}
                      aria-label={t('strokeWidth')}
                      onChange={() =>
                        commitSoftTextEnhancementParameter('strokeWidth', draftSoftStrokeWidth())
                      }
                      onInput={(event) =>
                        setDraftSoftStrokeWidth(Number(event.currentTarget.value))
                      }
                    />
                  </InputContainer>

                  <InputContainer
                    size="sm"
                    label={t('filterStrength')}
                    labelEnd={`${Math.round(draftSoftStrength() * 100)}%`}
                  >
                    <RangeInput
                      min={pdfSoftTextEnhancementRanges.strength.min}
                      max={pdfSoftTextEnhancementRanges.strength.max}
                      step={pdfSoftTextEnhancementRanges.strength.step}
                      value={draftSoftStrength()}
                      aria-label={t('filterStrength')}
                      onChange={() =>
                        commitSoftTextEnhancementParameter('strength', draftSoftStrength())
                      }
                      onInput={(event) => setDraftSoftStrength(Number(event.currentTarget.value))}
                    />
                  </InputContainer>
                </Show>

                <Show when={filter.id === 'invert' && filter.enabled && props.available}>
                  <InputContainer
                    size="sm"
                    label={t('filterStrength')}
                    labelEnd={`${Math.round(draftStrength() * 100)}%`}
                  >
                    <RangeInput
                      min="0"
                      max="1"
                      step="0.01"
                      value={draftStrength()}
                      aria-label={t('filterStrength')}
                      onChange={commitStrength}
                      onInput={(event) => setDraftStrength(Number(event.currentTarget.value))}
                    />
                  </InputContainer>
                </Show>

                <Show when={filter.id === 'visualAdjustment' && filter.enabled && props.available}>
                  <InputContainer
                    size="sm"
                    label={t('brightness')}
                    labelEnd={draftBrightness().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfVisualAdjustmentRanges.brightness.min}
                      max={pdfVisualAdjustmentRanges.brightness.max}
                      step={pdfVisualAdjustmentRanges.brightness.step}
                      value={draftBrightness()}
                      aria-label={t('brightness')}
                      onChange={() =>
                        commitVisualAdjustmentParameter('brightness', draftBrightness())
                      }
                      onInput={(event) => setDraftBrightness(Number(event.currentTarget.value))}
                    />
                  </InputContainer>

                  <InputContainer
                    size="sm"
                    label={t('contrast')}
                    labelEnd={draftVisualContrast().toFixed(2)}
                  >
                    <RangeInput
                      min={pdfVisualAdjustmentRanges.contrast.min}
                      max={pdfVisualAdjustmentRanges.contrast.max}
                      step={pdfVisualAdjustmentRanges.contrast.step}
                      value={draftVisualContrast()}
                      aria-label={t('contrast')}
                      onChange={() =>
                        commitVisualAdjustmentParameter('contrast', draftVisualContrast())
                      }
                      onInput={(event) => setDraftVisualContrast(Number(event.currentTarget.value))}
                    />
                  </InputContainer>

                  <InputContainer size="sm" label={t('gamma')} labelEnd={draftGamma().toFixed(2)}>
                    <RangeInput
                      min={pdfVisualAdjustmentRanges.gamma.min}
                      max={pdfVisualAdjustmentRanges.gamma.max}
                      step={pdfVisualAdjustmentRanges.gamma.step}
                      value={draftGamma()}
                      aria-label={t('gamma')}
                      onChange={() => commitVisualAdjustmentParameter('gamma', draftGamma())}
                      onInput={(event) => setDraftGamma(Number(event.currentTarget.value))}
                    />
                  </InputContainer>
                </Show>

                <Show when={filter.id === 'warmth' && filter.enabled && props.available}>
                  <InputContainer
                    size="sm"
                    label={t('filterStrength')}
                    labelEnd={`${Math.round(draftWarmthStrength() * 100)}%`}
                  >
                    <RangeInput
                      min="0"
                      max="1"
                      step="0.01"
                      value={draftWarmthStrength()}
                      aria-label={t('filterStrength')}
                      onChange={() => props.onWarmthStrengthChange(draftWarmthStrength())}
                      onInput={(event) => setDraftWarmthStrength(Number(event.currentTarget.value))}
                    />
                  </InputContainer>
                </Show>

                <Show when={filter.id === 'grayscale' && filter.enabled && props.available}>
                  <InputContainer
                    size="sm"
                    label={t('filterStrength')}
                    labelEnd={`${Math.round(draftGrayscaleStrength() * 100)}%`}
                  >
                    <RangeInput
                      min="0"
                      max="1"
                      step="0.01"
                      value={draftGrayscaleStrength()}
                      aria-label={t('filterStrength')}
                      onChange={() => props.onGrayscaleStrengthChange(draftGrayscaleStrength())}
                      onInput={(event) =>
                        setDraftGrayscaleStrength(Number(event.currentTarget.value))
                      }
                    />
                  </InputContainer>
                </Show>
              </section>
            )}
          </For>
        </div>

        <Show when={props.unavailableMessage}>
          <p class={styles.unavailableMessage} role="alert">
            {props.unavailableMessage}
          </p>
        </Show>
      </section>
    </ReaderSidePanel>
  );
}

export default FixedLayoutFilterPanel;
