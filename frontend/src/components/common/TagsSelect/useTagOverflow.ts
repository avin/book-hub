import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

const TAG_GAP = 4;

export function useTagOverflow(config: {
  value: () => string[];
  query: () => string;
  placeholder: () => string;
  isDropdownOpen: () => boolean;
  isCollapsedOpen: () => boolean;
  closeDropdown: () => void;
}) {
  const [inputWidth, setInputWidth] = createSignal(100);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [dropdownWidth, setDropdownWidth] = createSignal<number | undefined>(undefined);
  const [visibleTagCount, setVisibleTagCount] = createSignal(untrack(() => config.value().length));
  const tagMeasureEls: (HTMLSpanElement | undefined)[] = [];
  let inputContainerEl: HTMLDivElement | undefined;
  let measureInputWidthEl: HTMLSpanElement | undefined;
  let collapsedBadgeMeasureEl: HTMLSpanElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const visibleTags = createMemo(() => {
    const value = config.value();
    const safeVisibleCount = Math.min(visibleTagCount(), value.length);
    return value.slice(0, safeVisibleCount);
  });

  const hiddenTags = createMemo(() => {
    const value = config.value();
    const safeVisibleCount = Math.min(visibleTagCount(), value.length);
    return value.slice(safeVisibleCount);
  });

  createEffect(() => {
    if (!inputContainerEl) {
      return;
    }

    setContainerWidth(inputContainerEl.offsetWidth);
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    resizeObserver.observe(inputContainerEl);
  });

  createEffect(() => {
    if (!config.isDropdownOpen()) {
      setDropdownWidth(undefined);
      return;
    }

    if (dropdownWidth() === undefined && inputContainerEl) {
      setDropdownWidth(inputContainerEl.offsetWidth);
    }
  });

  createEffect(() => {
    if (!measureInputWidthEl || !inputContainerEl) {
      return;
    }

    const value = config.value();
    const textToMeasure = config.query() || (value.length ? '' : config.placeholder()) || ' ';
    measureInputWidthEl.textContent = textToMeasure || ' ';
    const measuredWidth = measureInputWidthEl.offsetWidth;
    const maxAvailableWidth = inputContainerEl.offsetWidth - 16;
    const nextInputWidth = Math.max(100, Math.min(measuredWidth + 10, maxAvailableWidth));
    setInputWidth(nextInputWidth);
  });

  createEffect(() => {
    const availableWidth = containerWidth() || inputContainerEl?.offsetWidth || 0;
    const value = config.value();
    const currentInputWidth = inputWidth();

    if (!availableWidth) {
      setVisibleTagCount(value.length);
      return;
    }

    const tagWidths = value.map((_, index) => tagMeasureEls[index]?.offsetWidth ?? 0);
    const prefixWidths = [0];
    for (const width of tagWidths) {
      prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width);
    }

    const getCollapsedBadgeWidth = (hiddenCount: number) => {
      if (!hiddenCount || !collapsedBadgeMeasureEl) {
        return 0;
      }

      collapsedBadgeMeasureEl.textContent = `+${hiddenCount}`;
      return collapsedBadgeMeasureEl.offsetWidth;
    };

    const getTotalWidth = (visibleCount: number) => {
      const hiddenCount = value.length - visibleCount;
      const tagsWidth = prefixWidths[visibleCount] ?? 0;
      const collapsedWidth = getCollapsedBadgeWidth(hiddenCount);
      const itemsCount = visibleCount + 1 + (hiddenCount > 0 ? 1 : 0);
      const gaps = TAG_GAP * Math.max(0, itemsCount - 1);

      return tagsWidth + collapsedWidth + currentInputWidth + gaps;
    };

    let nextVisibleCount = value.length;
    while (nextVisibleCount > 0 && getTotalWidth(nextVisibleCount) > availableWidth) {
      nextVisibleCount -= 1;
    }

    if (getTotalWidth(nextVisibleCount) > availableWidth) {
      nextVisibleCount = 0;
    }

    setVisibleTagCount((previousCount) =>
      previousCount === nextVisibleCount ? previousCount : nextVisibleCount,
    );
  });

  createEffect(() => {
    if (!hiddenTags().length && config.isCollapsedOpen()) {
      config.closeDropdown();
    }
  });

  onCleanup(() => resizeObserver?.disconnect());

  return {
    inputWidth,
    dropdownWidth,
    visibleTags,
    hiddenTags,
    setInputContainer(element: HTMLDivElement) {
      inputContainerEl = element;
    },
    setMeasureInputWidth(element: HTMLSpanElement) {
      measureInputWidthEl = element;
    },
    setCollapsedBadgeMeasure(element: HTMLSpanElement) {
      collapsedBadgeMeasureEl = element;
    },
    setTagMeasure(index: number, element: HTMLSpanElement) {
      tagMeasureEls[index] = element;
    },
  };
}
