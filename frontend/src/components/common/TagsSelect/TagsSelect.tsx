import { X } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import Dropdown from "@/components/common/Dropdown/Dropdown";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./TagsSelect.module.scss";

const RECENT_TAGS_STORAGE_KEY = "book-hub-tags-recent";
const MAX_RECENT_TAGS = 20;
const SEARCH_DEBOUNCE_MS = 200;

function normalizeTag(tag: string) {
  return tag.trim();
}

function getTagKey(tag: string) {
  return tag.toLowerCase();
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

    return parsed.map(normalizeTag).filter(Boolean);
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

  const tagByKey = new Map(tags.map((tag) => [getTagKey(tag), tag]));
  const recentInList = recentTags
    .map((tag) => tagByKey.get(getTagKey(tag)))
    .filter((tag): tag is string => Boolean(tag));

  if (!recentInList.length) {
    return tags;
  }

  const recentKeys = new Set(recentInList.map(getTagKey));
  const rest = tags.filter((tag) => !recentKeys.has(getTagKey(tag)));
  return [...recentInList, ...rest];
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
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [options, setOptions] = createSignal<string[]>([]);
  const [focusedOptionIndex, setFocusedOptionIndex] = createSignal<number | null>(null);

  let inputEl: HTMLInputElement | undefined;
  let menuEl: HTMLDivElement | undefined;
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let searchRequestId = 0;
  let pointerDownInMenu = false;

  const selectedKeys = createMemo(() => new Set(props.value.map(getTagKey)));

  const normalizeOptions = (nextOptions: string[]) => {
    const seen = new Set<string>();

    const availableOptions = nextOptions
      .map(normalizeTag)
      .filter((option) => {
        const key = getTagKey(option);
        if (!option || selectedKeys().has(key) || seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

    return sortTagsByRecent(availableOptions, loadRecentTags());
  };

  const searchLocalOptions = (searchQuery: string) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return (props.options ?? []).filter((option) =>
      option.toLowerCase().includes(normalizedQuery),
    );
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
    setFocusedOptionIndex(null);
    setOpen(normalizedOptions.length > 0);
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

  const closeOptions = () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchRequestId += 1;
    setOpen(false);
    setFocusedOptionIndex(null);
  };

  const updateRecentTags = (addedTags: string[]) => {
    if (!addedTags.length) {
      return;
    }

    let nextRecentTags = loadRecentTags();
    for (const tag of addedTags) {
      const normalized = normalizeTag(tag);
      if (!normalized) {
        continue;
      }

      nextRecentTags = [
        normalized,
        ...nextRecentTags.filter((recentTag) => getTagKey(recentTag) !== getTagKey(normalized)),
      ];
    }

    saveRecentTags(nextRecentTags.slice(0, MAX_RECENT_TAGS));
  };

  const visibleOptions = createMemo(() => {
    const normalized = normalizeOptions(options());
    return normalized;
  });

  const addTag = (tag: string) => {
    const normalized = normalizeTag(tag);

    if (!normalized || selectedKeys().has(getTagKey(normalized))) {
      return;
    }

    props.onChange([...props.value, normalized]);
    updateRecentTags([normalized]);
    setQuery("");
    closeOptions();
  };

  const removeTag = (tag: string) => {
    props.onChange(props.value.filter((selected) => selected !== tag));
  };

  const addTypedTag = () => {
    const normalized = normalizeTag(query());
    if (!normalized) {
      closeOptions();
      return;
    }

    addTag(normalized);
  };

  const applyCurrentInput = () => {
    const focusedIndex = focusedOptionIndex();
    const option = focusedIndex === null ? undefined : visibleOptions()[focusedIndex];

    if (option) {
      addTag(option);
      return;
    }

    addTypedTag();
  };

  const handleInputFocus = () => {
    if (props.disabled) {
      return;
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
    if (
      pointerDownInMenu ||
      (relatedTarget instanceof Node && menuEl?.contains(relatedTarget))
    ) {
      setTimeout(() => {
        pointerDownInMenu = false;
      });
      return;
    }

    addTypedTag();
  };

  onCleanup(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
  });

  return (
    <Dropdown
      open={open()}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }

        closeOptions();
      }}
      trigger={
        <div
          class={styles.inputContainer}
          classList={{ [styles.disabled]: props.disabled }}
          data-input-control="true"
          data-filled={props.value.length > 0 ? "true" : undefined}
          onClick={() => inputEl?.focus()}
        >
          <Show when={props.value.length > 0}>
            <span class={styles.tags}>
              <For each={props.value}>
                {(tag) => (
                  <span class={styles.tag} onClick={(event) => event.stopPropagation()}>
                    {tag}
                    <button
                      type="button"
                      class={styles.removeButton}
                      aria-label={`Remove ${tag}`}
                      disabled={props.disabled}
                      onClick={() => removeTag(tag)}
                    >
                      <X />
                    </button>
                  </span>
                )}
              </For>
            </span>
          </Show>

          <input
            ref={inputEl}
            class={styles.input}
            value={query()}
            placeholder={props.value.length > 0 ? undefined : props.placeholder ?? t("findOrAddTag")}
            disabled={props.disabled}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onInput={(event) => {
              const nextQuery = event.currentTarget.value;
              setQuery(nextQuery);
              debouncedSearchOptions(nextQuery);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                if (!open() || !visibleOptions().length) {
                  return;
                }

                event.preventDefault();
                setFocusedOptionIndex((currentIndex) =>
                  currentIndex === null || currentIndex === visibleOptions().length - 1
                    ? 0
                    : currentIndex + 1,
                );
              }

              if (event.key === "ArrowUp") {
                if (!open() || !visibleOptions().length) {
                  return;
                }

                event.preventDefault();
                setFocusedOptionIndex((currentIndex) =>
                  currentIndex === null || currentIndex === 0
                    ? visibleOptions().length - 1
                    : currentIndex - 1,
                );
              }

              if (event.key === "Enter") {
                event.preventDefault();
                applyCurrentInput();
              }

              if (event.key === "Backspace" && !query() && props.value.length > 0) {
                event.preventDefault();
                removeTag(props.value[props.value.length - 1]);
              }
            }}
          />
        </div>
      }
    >
      <div
        ref={menuEl}
        class={styles.menu}
        onPointerDown={() => {
          pointerDownInMenu = true;
        }}
      >
        <div class={styles.options}>
          <For each={visibleOptions()}>
            {(option, index) => (
              <button
                type="button"
                class={styles.option}
                classList={{ [styles.focusedOption]: focusedOptionIndex() === index() }}
                onClick={() => addTag(option)}
                onMouseEnter={() => setFocusedOptionIndex(index())}
              >
                <span>{option}</span>
              </button>
            )}
          </For>

          <Show when={visibleOptions().length === 0}>
            <div class={styles.empty}>{t("noOptions")}</div>
          </Show>
        </div>
      </div>
    </Dropdown>
  );
}

export default TagsSelect;
