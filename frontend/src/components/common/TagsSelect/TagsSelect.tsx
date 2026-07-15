import { X } from 'lucide-solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import { useI18n } from '@/i18n/I18nProvider';
import { getRecentTagsPreference, setRecentTagsPreference } from '@/storage/browserPreferences';
import { mergeRecentTags, normalizeTag, normalizeTags, sortTagsByRecent } from './tagUtils';
import styles from './TagsSelect.module.scss';

const MAX_RECENT_TAGS = 20;
const SEARCH_DEBOUNCE_MS = 200;
const DOUBLE_BACKSPACE_MS = 450;
const TAG_GAP = 4;

function loadRecentTags() {
  return normalizeTags(getRecentTagsPreference());
}

function saveRecentTags(tags: string[]) {
  setRecentTagsPreference(tags);
}

function preventLabelActivation(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function TagBadge(props: {
  tag: string;
  measure?: boolean;
  disabled?: boolean;
  ref?: (element: HTMLSpanElement) => void;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const handleClick = (event: MouseEvent) => {
    preventLabelActivation(event);
    props.onClick?.();
  };

  return (
    <span ref={props.ref} class={styles.badge} data-tag-badge onClick={handleClick}>
      <span class={styles.badgeContent}>
        {props.tag}
        <Show
          when={!props.measure}
          fallback={
            <span class={styles.removeButton} aria-hidden="true">
              <X />
            </span>
          }
        >
          <button
            type="button"
            class={styles.removeButton}
            aria-label={`Remove ${props.tag}`}
            disabled={props.disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (props.disabled) {
                return;
              }

              props.onRemove?.();
            }}
          >
            <X />
          </button>
        </Show>
      </span>
    </span>
  );
}

function TagsSelect(props: {
  value: string[];
  options?: string[];
  onSearchOptions?: (query: string) => string[] | Promise<string[]>;
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  showOptionsOnFocus?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = createSignal('');
  const [options, setOptions] = createSignal<string[]>([]);
  const [dropdownMode, setDropdownMode] = createSignal<'options' | 'collapsed' | null>(null);
  const [focusedOptionIndex, setFocusedOptionIndex] = createSignal<number | null>(null);
  const [arrowScrolling, setArrowScrolling] = createSignal(false);
  const [inputWidth, setInputWidth] = createSignal(100);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [dropdownWidth, setDropdownWidth] = createSignal<number | undefined>(undefined);
  const [visibleTagCount, setVisibleTagCount] = createSignal(untrack(() => props.value.length));

  let inputEl: HTMLInputElement | undefined;
  let inputContainerEl: HTMLDivElement | undefined;
  let dropdownEl: HTMLDivElement | undefined;
  let listContainerEl: HTMLDivElement | undefined;
  let measureInputWidthEl: HTMLSpanElement | undefined;
  let collapsedBadgeMeasureEl: HTMLSpanElement | undefined;
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let searchRequestId = 0;
  let resizeObserver: ResizeObserver | undefined;
  let shouldOpenOptionsAfterSearch = false;
  let lastEmptyInputBackspaceAt = 0;
  const knownOptions: string[] = [];
  const tagMeasureEls: (HTMLSpanElement | undefined)[] = [];

  const placeholder = () => props.placeholder ?? t('findOrAddTag');
  const isOptionsOpen = () => dropdownMode() === 'options';
  const isCollapsedOpen = () => dropdownMode() === 'collapsed';
  const isDropdownOpen = () => dropdownMode() !== null;

  const closeDropdown = () => {
    shouldOpenOptionsAfterSearch = false;
    setDropdownMode(null);
  };

  const openOptions = () => {
    if (props.disabled || !(props.showOptionsOnFocus ?? true)) {
      return;
    }

    inputEl?.focus();
    shouldOpenOptionsAfterSearch = true;
    debouncedSearchOptions(query(), true);
  };

  const toggleCollapsedDropdown = () => {
    shouldOpenOptionsAfterSearch = false;
    setDropdownMode((previousMode) => (previousMode === 'collapsed' ? null : 'collapsed'));
  };

  const normalizeOptions = (nextOptions: string[]) => {
    const seen = new Set<string>();

    const availableOptions = nextOptions.map(normalizeTag).filter((option) => {
      if (!option || props.value.includes(option) || seen.has(option)) {
        return false;
      }

      seen.add(option);
      return true;
    });

    return sortTagsByRecent(availableOptions, loadRecentTags());
  };

  const rememberOptions = (nextOptions: string[]) => {
    const knownOptionsSet = new Set(knownOptions);
    for (const option of nextOptions) {
      if (knownOptionsSet.has(option)) {
        continue;
      }

      knownOptionsSet.add(option);
      knownOptions.push(option);
    }
  };

  const searchLocalOptions = (searchQuery: string) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const localOptions = [...(props.options ?? []), ...knownOptions];

    return localOptions.filter((option) => {
      if (!normalizedQuery) {
        return true;
      }

      return option.toLowerCase().includes(normalizedQuery);
    });
  };

  const searchOptions = async (searchQuery: string) => {
    const requestId = ++searchRequestId;
    let nextOptions: string[] = [];

    try {
      nextOptions = props.onSearchOptions
        ? await props.onSearchOptions(searchQuery)
        : searchLocalOptions(searchQuery);
    } catch {
      nextOptions = [];
    }

    if (requestId !== searchRequestId) {
      return;
    }

    rememberOptions(nextOptions);

    const normalizedOptions = normalizeOptions(nextOptions);
    setOptions(normalizedOptions);
    if (shouldOpenOptionsAfterSearch) {
      setDropdownMode(normalizedOptions.length ? 'options' : null);
    }
  };

  const debouncedSearchOptions = (searchQuery: string, immediate = false) => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (immediate) {
      void searchOptions(searchQuery);
      return;
    }

    searchTimeout = setTimeout(() => {
      searchTimeout = undefined;
      void searchOptions(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
  };

  const cancelSearch = () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = undefined;
    }

    searchRequestId += 1;
  };

  const updateRecentTags = (addedTags: string[]) => {
    if (!addedTags.length) {
      return;
    }

    saveRecentTags(mergeRecentTags(loadRecentTags(), addedTags, MAX_RECENT_TAGS));
  };

  const addTag = (tag: string) => {
    const normalized = normalizeTag(tag);

    if (!normalized || props.value.includes(normalized)) {
      return;
    }

    props.onChange([...props.value, normalized]);
    updateRecentTags([normalized]);
    setQuery('');
    closeDropdown();
  };

  const removeTag = (tag: string) => {
    lastEmptyInputBackspaceAt = 0;
    props.onChange(props.value.filter((selected) => selected !== tag));
  };

  const removeLastTag = () => {
    const lastTag = props.value[props.value.length - 1];
    if (!lastTag) {
      return;
    }

    removeTag(lastTag);
  };

  const applyTypedInput = () => {
    cancelSearch();

    const normalized = normalizeTag(query());
    if (!normalized) {
      closeDropdown();
      return;
    }

    if (!props.value.includes(normalized)) {
      props.onChange([...props.value, normalized]);
      updateRecentTags([normalized]);
    }

    setQuery('');
    closeDropdown();
  };

  const applyCurrentInput = () => {
    cancelSearch();

    const focusedIndex = focusedOptionIndex();
    const option = focusedIndex === null ? undefined : options()[focusedIndex];
    if (option) {
      addTag(option);
      return;
    }

    applyTypedInput();
  };

  const handleChangeQuery = (nextQuery: string) => {
    const normalizedQuery = nextQuery.toLowerCase();

    setQuery(normalizedQuery);
    lastEmptyInputBackspaceAt = 0;
    setFocusedOptionIndex(null);
    shouldOpenOptionsAfterSearch = true;
    if (!isOptionsOpen()) {
      setDropdownMode(null);
    }

    debouncedSearchOptions(normalizedQuery);
  };

  const handleInputFocus = () => {
    if (props.disabled) {
      return;
    }

    shouldOpenOptionsAfterSearch = true;
    if (!isOptionsOpen()) {
      setDropdownMode(null);
    }

    if (props.showOptionsOnFocus ?? true) {
      debouncedSearchOptions(query(), true);
      return;
    }

    if (query().trim()) {
      debouncedSearchOptions(query());
    }
  };

  const handleInputBlur = (event: FocusEvent) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof HTMLElement && dropdownEl?.contains(relatedTarget)) {
      return;
    }

    applyTypedInput();
  };

  const handleContainerClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('[data-tag-badge]') || target.tagName === 'BUTTON') {
      return;
    }

    if (target !== inputEl) {
      event.preventDefault();
      event.stopPropagation();
    }

    inputEl?.focus();
    openOptions();
  };

  const handleEmptyInputBackspace = (event: KeyboardEvent) => {
    if (inputEl?.value.length) {
      return;
    }

    if (!props.value.length) {
      return;
    }

    event.preventDefault();
    if (event.repeat) {
      return;
    }

    const now = Date.now();
    const isDoubleBackspace = now - lastEmptyInputBackspaceAt <= DOUBLE_BACKSPACE_MS;
    lastEmptyInputBackspaceAt = isDoubleBackspace ? 0 : now;

    if (!isDoubleBackspace) {
      return;
    }

    if (hiddenTags().length > 0 && !isCollapsedOpen()) {
      shouldOpenOptionsAfterSearch = false;
      setDropdownMode('collapsed');
      return;
    }

    removeLastTag();
  };

  const scrollToFocused = () => {
    const container = listContainerEl;
    if (!container) {
      return;
    }

    const focusedElement = container.querySelector('[data-focused="1"]');
    if (!focusedElement) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = focusedElement.getBoundingClientRect();
    const elementCenter = elementRect.top + elementRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;

    container.scrollTop += elementCenter - containerCenter;
  };

  const visibleTags = createMemo(() => {
    const safeVisibleCount = Math.min(visibleTagCount(), props.value.length);
    return props.value.slice(0, safeVisibleCount);
  });

  const hiddenTags = createMemo(() => {
    const safeVisibleCount = Math.min(visibleTagCount(), props.value.length);
    return props.value.slice(safeVisibleCount);
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
    if (!isDropdownOpen()) {
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

    const textToMeasure = query() || (props.value.length ? '' : placeholder()) || ' ';
    measureInputWidthEl.textContent = textToMeasure || ' ';
    const measuredWidth = measureInputWidthEl.offsetWidth;
    const maxAvailableWidth = inputContainerEl.offsetWidth - 16;
    const nextInputWidth = Math.max(100, Math.min(measuredWidth + 10, maxAvailableWidth));
    setInputWidth(nextInputWidth);
  });

  createEffect(() => {
    const availableWidth = containerWidth() || inputContainerEl?.offsetWidth || 0;
    const currentValue = props.value;
    const currentInputWidth = inputWidth();

    if (!availableWidth) {
      setVisibleTagCount(currentValue.length);
      return;
    }

    const tagWidths = currentValue.map((_, index) => tagMeasureEls[index]?.offsetWidth ?? 0);
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
      const hiddenCount = currentValue.length - visibleCount;
      const tagsWidth = prefixWidths[visibleCount] ?? 0;
      const collapsedWidth = getCollapsedBadgeWidth(hiddenCount);
      const itemsCount = visibleCount + 1 + (hiddenCount > 0 ? 1 : 0);
      const gaps = TAG_GAP * Math.max(0, itemsCount - 1);

      return tagsWidth + collapsedWidth + currentInputWidth + gaps;
    };

    let nextVisibleCount = currentValue.length;
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
    if (!isOptionsOpen()) {
      setFocusedOptionIndex(null);
    }
  });

  createEffect(() => {
    if (!hiddenTags().length && isCollapsedOpen()) {
      closeDropdown();
    }
  });

  createEffect(() => {
    const focusedIndex = focusedOptionIndex();
    if (!arrowScrolling() || !isOptionsOpen() || focusedIndex === null || !options().length) {
      return;
    }

    const animationFrameId = requestAnimationFrame(scrollToFocused);
    onCleanup(() => cancelAnimationFrame(animationFrameId));
  });

  onCleanup(() => {
    cancelSearch();
    resizeObserver?.disconnect();
  });

  return (
    <Dropdown
      open={isDropdownOpen()}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDropdownMode('options');
          return;
        }

        closeDropdown();
      }}
      placement="bottom-start"
      trigger={
        <>
          <div
            ref={inputContainerEl}
            class={styles.inputContainer}
            classList={{ [styles.disabled]: props.disabled }}
            onClick={handleContainerClick}
          >
            <For each={visibleTags()}>
              {(tag) => (
                <TagBadge
                  tag={tag}
                  disabled={props.disabled}
                  onClick={openOptions}
                  onRemove={() => removeTag(tag)}
                />
              )}
            </For>

            <Show when={hiddenTags().length > 0}>
              <span
                class={`${styles.badge} ${styles.collapsedBadge}`}
                data-tag-badge
                role="button"
                aria-disabled={props.disabled ? 'true' : undefined}
                tabIndex={props.disabled ? undefined : 0}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (props.disabled) {
                    return;
                  }

                  toggleCollapsedDropdown();
                }}
                onKeyDown={(event) => {
                  if (props.disabled || (event.key !== 'Enter' && event.key !== ' ')) {
                    return;
                  }

                  event.preventDefault();
                  toggleCollapsedDropdown();
                }}
              >
                +{hiddenTags().length}
              </span>
            </Show>

            <span ref={measureInputWidthEl} class={styles.measureInputWidth} aria-hidden="true" />
            <input
              ref={inputEl}
              type="text"
              value={query()}
              class={styles.input}
              style={{ width: `${inputWidth()}px` }}
              placeholder={props.value.length ? undefined : placeholder()}
              disabled={props.disabled}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onInput={(event) => handleChangeQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Backspace') {
                  handleEmptyInputBackspace(event);
                  return;
                }

                if (event.key === 'ArrowDown') {
                  if (!isOptionsOpen() || !options().length) {
                    return;
                  }

                  event.preventDefault();
                  setArrowScrolling(true);
                  setFocusedOptionIndex((currentIndex) =>
                    currentIndex === null || currentIndex === options().length - 1
                      ? 0
                      : currentIndex + 1,
                  );
                }

                if (event.key === 'ArrowUp') {
                  if (!isOptionsOpen() || !options().length) {
                    return;
                  }

                  event.preventDefault();
                  setArrowScrolling(true);
                  setFocusedOptionIndex((currentIndex) =>
                    currentIndex === null || currentIndex === 0
                      ? options().length - 1
                      : currentIndex - 1,
                  );
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyCurrentInput();
                }
              }}
            />
          </div>

          <div class={styles.measureContainer} aria-hidden="true">
            <For each={props.value}>
              {(tag, index) => (
                <TagBadge
                  tag={tag}
                  measure
                  ref={(element) => {
                    tagMeasureEls[index()] = element;
                  }}
                />
              )}
            </For>
            <span ref={collapsedBadgeMeasureEl} class={styles.badge} />
          </div>
        </>
      }
    >
      <Show
        when={isCollapsedOpen()}
        fallback={
          <div ref={dropdownEl} class={styles.menu} style={{ width: `${dropdownWidth() ?? 0}px` }}>
            <div ref={listContainerEl} class={styles.optionsList}>
              <For each={options()}>
                {(option, index) => (
                  <button
                    type="button"
                    class={styles.option}
                    data-focused={focusedOptionIndex() === index() ? '1' : undefined}
                    classList={{ [styles.focusedOption]: focusedOptionIndex() === index() }}
                    onClick={() => addTag(option)}
                    onMouseEnter={() => {
                      setArrowScrolling(false);
                      setFocusedOptionIndex(index());
                    }}
                  >
                    <span>{option}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        }
      >
        <div
          ref={dropdownEl}
          class={styles.collapsedTagsDropdownArea}
          style={{ width: `${dropdownWidth() ?? 0}px` }}
        >
          <For each={hiddenTags()}>
            {(tag) => (
              <TagBadge tag={tag} disabled={props.disabled} onRemove={() => removeTag(tag)} />
            )}
          </For>
        </div>
      </Show>
    </Dropdown>
  );
}

export default TagsSelect;
