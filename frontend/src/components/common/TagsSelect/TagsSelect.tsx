import { X } from "lucide-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import Dropdown from "@/components/common/Dropdown/Dropdown";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./TagsSelect.module.scss";

const RECENT_TAGS_STORAGE_KEY = "book-hub-tags-recent";
const MAX_RECENT_TAGS = 20;
const SEARCH_DEBOUNCE_MS = 200;
const TAG_GAP = 4;

function normalizeTag(tag: string) {
  return tag.trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function loadRecentTags() {
  try {
    const raw = localStorage.getItem(RECENT_TAGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isStringArray(parsed)) {
      return [];
    }

    return parsed.filter((tag) => tag.trim().length > 0);
  } catch {
    return [];
  }
}

function saveRecentTags(tags: string[]) {
  try {
    localStorage.setItem(RECENT_TAGS_STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // localStorage can be unavailable in private mode or restricted contexts.
  }
}

function sortTagsByRecent(tags: string[], recentTags: string[]) {
  if (!recentTags.length) {
    return tags;
  }

  const tagsSet = new Set(tags);
  const recentInList = recentTags.filter((tag) => tagsSet.has(tag));
  if (!recentInList.length) {
    return tags;
  }

  const recentSet = new Set(recentInList);
  const rest = tags.filter((tag) => !recentSet.has(tag));
  return [...recentInList, ...rest];
}

function TagBadge(props: {
  tag: string;
  measure?: boolean;
  disabled?: boolean;
  ref?: (element: HTMLSpanElement) => void;
  onRemove?: () => void;
}) {
  const preventLabelActivation = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <span
      ref={props.ref}
      class={styles.badge}
      classList={{ [styles.measureItem]: props.measure }}
      data-tag-badge
      onClick={preventLabelActivation}
    >
      <span class={styles.badgeContent}>
        {props.tag}
        <button
          type="button"
          class={styles.removeButton}
          tabIndex={props.measure ? -1 : undefined}
          aria-hidden={props.measure ? "true" : undefined}
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
  const [query, setQuery] = createSignal("");
  const [options, setOptions] = createSignal<string[]>([]);
  const [dropdownMode, setDropdownMode] = createSignal<"options" | "collapsed" | null>(null);
  const [requestedDropdownMode, setRequestedDropdownMode] =
    createSignal<"options" | "collapsed" | null>(null);
  const [focusedOptionIndex, setFocusedOptionIndex] = createSignal<number | null>(null);
  const [arrowScrolling, setArrowScrolling] = createSignal(false);
  const [inputWidth, setInputWidth] = createSignal(100);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [dropdownWidth, setDropdownWidth] = createSignal<number | undefined>(undefined);
  const [visibleTagCount, setVisibleTagCount] = createSignal(props.value.length);

  let inputEl: HTMLInputElement | undefined;
  let inputContainerEl: HTMLDivElement | undefined;
  let dropdownEl: HTMLDivElement | undefined;
  let listContainerEl: HTMLDivElement | undefined;
  let measureInputWidthEl: HTMLSpanElement | undefined;
  let collapsedBadgeMeasureEl: HTMLSpanElement | undefined;
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let searchRequestId = 0;
  let resizeObserver: ResizeObserver | undefined;
  const tagMeasureEls: (HTMLSpanElement | undefined)[] = [];

  const placeholder = () => props.placeholder ?? t("findOrAddTag");
  const isOptionsOpen = () => dropdownMode() === "options";
  const isCollapsedOpen = () => dropdownMode() === "collapsed";
  const isDropdownOpen = () => dropdownMode() !== null;

  const closeDropdown = () => {
    setRequestedDropdownMode(null);
    setDropdownMode(null);
  };

  const normalizeOptions = (nextOptions: string[]) => {
    const seen = new Set<string>();

    const availableOptions = nextOptions
      .map(normalizeTag)
      .filter((option) => {
        if (!option || props.value.includes(option) || seen.has(option)) {
          return false;
        }

        seen.add(option);
        return true;
      });

    return sortTagsByRecent(availableOptions, loadRecentTags());
  };

  const searchLocalOptions = (searchQuery: string) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return (props.options ?? [])
      .filter((option) => !props.value.includes(option))
      .filter((option) => {
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

    const normalizedOptions = normalizeOptions(nextOptions);
    setOptions(normalizedOptions);
    if (requestedDropdownMode() === "options") {
      setDropdownMode(normalizedOptions.length ? "options" : null);
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

    let nextRecentTags = [...loadRecentTags()];
    for (const tag of addedTags) {
      if (!tag.trim()) {
        continue;
      }

      nextRecentTags = [tag, ...nextRecentTags.filter((recentTag) => recentTag !== tag)];
    }

    saveRecentTags(nextRecentTags.slice(0, MAX_RECENT_TAGS));
  };

  const addTag = (tag: string) => {
    const normalized = normalizeTag(tag);

    if (!normalized || props.value.includes(normalized)) {
      return;
    }

    props.onChange([...props.value, normalized]);
    updateRecentTags([normalized]);
    setQuery("");
    closeDropdown();
  };

  const removeTag = (tag: string) => {
    props.onChange(props.value.filter((selected) => selected !== tag));
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

    setQuery("");
    closeDropdown();
  };

  const applyCurrentInput = () => {
    cancelSearch();

    const focusedIndex = focusedOptionIndex();
    const option = focusedIndex === null ? undefined : options()[focusedIndex];
    if (option && !props.value.includes(option)) {
      props.onChange([...props.value, option]);
      updateRecentTags([option]);
      setQuery("");
      closeDropdown();
      return;
    }

    applyTypedInput();
  };

  const handleChangeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setFocusedOptionIndex(null);
    setRequestedDropdownMode("options");
    if (!isOptionsOpen()) {
      setDropdownMode(null);
    }

    debouncedSearchOptions(nextQuery);
  };

  const handleInputFocus = () => {
    if (props.disabled) {
      return;
    }

    setRequestedDropdownMode("options");
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

    if (target.closest("[data-tag-badge]") || target.tagName === "BUTTON") {
      return;
    }

    if (target !== inputEl) {
      event.preventDefault();
      event.stopPropagation();
    }

    inputEl?.focus();
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

    const textToMeasure = query() || (props.value.length ? "" : placeholder()) || " ";
    measureInputWidthEl.textContent = textToMeasure || " ";
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
    if (arrowScrolling() && isOptionsOpen() && options().length > 0) {
      scrollToFocused();
    }
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
          setDropdownMode(requestedDropdownMode() ?? "options");
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
                  onRemove={() => removeTag(tag)}
                />
              )}
            </For>

            <Show when={hiddenTags().length > 0}>
              <span
                class={`${styles.badge} ${styles.collapsedBadge}`}
                data-tag-badge
                role="button"
                aria-disabled={props.disabled ? "true" : undefined}
                tabIndex={props.disabled ? undefined : 0}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (props.disabled) {
                    return;
                  }

                  setDropdownMode((previousMode) => {
                    const nextMode = previousMode === "collapsed" ? null : "collapsed";
                    setRequestedDropdownMode(nextMode);
                    return nextMode;
                  });
                }}
                onKeyDown={(event) => {
                  if (props.disabled || (event.key !== "Enter" && event.key !== " ")) {
                    return;
                  }

                  event.preventDefault();
                  setDropdownMode((previousMode) => {
                    const nextMode = previousMode === "collapsed" ? null : "collapsed";
                    setRequestedDropdownMode(nextMode);
                    return nextMode;
                  });
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
                if (event.key === "ArrowDown") {
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

                if (event.key === "ArrowUp") {
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

                if (event.key === "Enter") {
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
            <span ref={collapsedBadgeMeasureEl} class={`${styles.badge} ${styles.measureItem}`} />
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
                    data-focused={focusedOptionIndex() === index() ? "1" : undefined}
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

              <Show when={options().length === 0}>
                <div class={styles.empty}>{t("noOptions")}</div>
              </Show>
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
              <TagBadge
                tag={tag}
                disabled={props.disabled}
                onRemove={() => removeTag(tag)}
              />
            )}
          </For>
        </div>
      </Show>
    </Dropdown>
  );
}

export default TagsSelect;
