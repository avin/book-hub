import { batch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { getRecentTagsPreference, setRecentTagsPreference } from '@/storage/browserPreferences';
import {
  MAX_TAGS,
  mergeRecentTags,
  normalizeTag,
  normalizeTags,
  sortTagsByRecent,
} from './tagUtils';

const MAX_RECENT_TAGS = 20;
const SEARCH_DEBOUNCE_MS = 200;
const DOUBLE_BACKSPACE_MS = 450;

export function createTagOptionSearch() {
  let requestId = 0;

  return {
    async run(search: () => string[] | Promise<string[]>) {
      const currentRequestId = ++requestId;
      let options: string[];

      try {
        options = await search();
      } catch {
        options = [];
      }

      return currentRequestId === requestId ? options : undefined;
    },
    cancel() {
      requestId += 1;
    },
  };
}

export function createTagSelectionModel(config: {
  value: () => string[];
  options: () => string[] | undefined;
  onSearchOptions: () => ((query: string) => string[] | Promise<string[]>) | undefined;
  onChange: (value: string[]) => void;
  disabled: () => boolean;
  showOptionsOnFocus: () => boolean;
}) {
  const [query, setQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<string[]>([]);
  const [dropdownMode, setDropdownMode] = createSignal<'options' | 'collapsed' | null>(null);
  const [focusedOptionIndex, setFocusedOptionIndex] = createSignal<number | null>(null);
  const [arrowScrolling, setArrowScrolling] = createSignal(false);
  const optionSearch = createTagOptionSearch();
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  const [shouldOpenOptionsAfterSearch, setShouldOpenOptionsAfterSearch] = createSignal(false);
  let lastEmptyInputBackspaceAt: number | undefined;

  const isOptionsOpen = () => dropdownMode() === 'options';
  const isCollapsedOpen = () => dropdownMode() === 'collapsed';
  const isDropdownOpen = () => dropdownMode() !== null;

  const loadRecentTags = () => normalizeTags(getRecentTagsPreference());
  const isAtLimit = createMemo(() => normalizeTags(config.value()).length >= MAX_TAGS);

  const closeDropdown = () => {
    cancelSearch();
    lastEmptyInputBackspaceAt = undefined;
    setShouldOpenOptionsAfterSearch(false);
    setDropdownMode(null);
  };

  const normalizeOptions = (nextOptions: string[]) => {
    if (isAtLimit()) return [];
    const seen = new Set<string>();
    const selectedTags = normalizeTags(config.value());
    const availableOptions = nextOptions.map(normalizeTag).filter((option) => {
      if (!option || selectedTags.includes(option) || seen.has(option)) {
        return false;
      }

      seen.add(option);
      return true;
    });

    return sortTagsByRecent(availableOptions, loadRecentTags());
  };

  const searchLocalOptions = (searchQuery: string) => {
    const normalizedQuery = normalizeTag(searchQuery);
    return (config.options() ?? []).filter((option) =>
      normalizeTag(option).includes(normalizedQuery),
    );
  };

  const options = createMemo(() =>
    normalizeOptions(config.onSearchOptions() ? searchResults() : searchLocalOptions(query())),
  );

  const searchOptions = async (searchQuery: string) => {
    const nextOptions = await optionSearch.run(() => {
      const onSearchOptions = config.onSearchOptions();
      return onSearchOptions ? onSearchOptions(searchQuery) : searchLocalOptions(searchQuery);
    });

    if (!nextOptions) {
      return;
    }

    setSearchResults(nextOptions);
  };

  const debouncedSearchOptions = (searchQuery: string, immediate = false) => {
    cancelSearch();
    setSearchResults([]);
    if (!config.onSearchOptions()) return;

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

    optionSearch.cancel();
  };

  const updateRecentTags = (addedTags: string[]) => {
    if (!addedTags.length) {
      return;
    }

    setRecentTagsPreference(mergeRecentTags(loadRecentTags(), addedTags, MAX_RECENT_TAGS));
  };

  const addTag = (tag: string) => {
    if (config.disabled()) return;
    const normalized = normalizeTag(tag);
    const selectedTags = normalizeTags(config.value());

    if (normalized && !isAtLimit() && !selectedTags.includes(normalized)) {
      config.onChange([...selectedTags, normalized]);
      updateRecentTags([normalized]);
    }

    closeDropdown();
    setQuery('');
  };

  const removeTag = (tag: string) => {
    if (config.disabled()) return;
    lastEmptyInputBackspaceAt = undefined;
    config.onChange(config.value().filter((selected) => selected !== tag));
  };

  const removeLastTag = () => {
    const selectedTags = config.value();
    const lastTag = selectedTags[selectedTags.length - 1];
    if (!lastTag) {
      return;
    }

    removeTag(lastTag);
  };

  const applyTypedInput = () => {
    addTag(query());
  };

  const openCollapsedDropdown = () => {
    if (config.disabled()) return;
    lastEmptyInputBackspaceAt = undefined;
    cancelSearch();
    setShouldOpenOptionsAfterSearch(false);
    setDropdownMode('collapsed');
  };

  createEffect(() => {
    options();
    setFocusedOptionIndex(null);
    setArrowScrolling(false);
  });

  createEffect(() => {
    if (shouldOpenOptionsAfterSearch()) {
      setDropdownMode(options().length ? 'options' : null);
    }
  });

  createEffect(() => {
    if (config.disabled()) closeDropdown();
  });

  createEffect(() => {
    if (!isOptionsOpen()) {
      setFocusedOptionIndex(null);
    }
  });

  onCleanup(cancelSearch);

  return {
    query,
    isAtLimit,
    options,
    focusedOptionIndex,
    arrowScrolling,
    isOptionsOpen,
    isCollapsedOpen,
    isDropdownOpen,
    wantsOptions: shouldOpenOptionsAfterSearch,
    openCollapsedDropdown,
    closeDropdown,
    openOptions() {
      lastEmptyInputBackspaceAt = undefined;
      if (config.disabled() || !config.showOptionsOnFocus()) {
        return;
      }

      batch(() => {
        debouncedSearchOptions(normalizeTag(query()), true);
        setShouldOpenOptionsAfterSearch(true);
      });
    },
    toggleCollapsedDropdown() {
      if (config.disabled()) return;
      if (isCollapsedOpen()) closeDropdown();
      else openCollapsedDropdown();
    },
    handleDropdownOpenChange(nextOpen: boolean) {
      if (nextOpen) {
        if (!config.disabled()) setShouldOpenOptionsAfterSearch(true);
        return;
      }

      closeDropdown();
    },
    addTag,
    removeTag,
    applyTypedInput,
    applyCurrentInput() {
      if (config.disabled()) return;
      cancelSearch();

      const focusedIndex = focusedOptionIndex();
      const option = isOptionsOpen() && focusedIndex !== null ? options()[focusedIndex] : undefined;
      if (option) {
        addTag(option);
        return;
      }

      applyTypedInput();
    },
    handleChangeQuery(nextQuery: string) {
      if (config.disabled()) return;
      batch(() => {
        setQuery(nextQuery);
        lastEmptyInputBackspaceAt = undefined;
        setFocusedOptionIndex(null);
        setShouldOpenOptionsAfterSearch(true);
        debouncedSearchOptions(normalizeTag(nextQuery));
      });
    },
    handleInputFocus() {
      if (config.disabled()) {
        return;
      }

      lastEmptyInputBackspaceAt = undefined;
      if (isCollapsedOpen()) return;
      if (config.showOptionsOnFocus()) {
        batch(() => {
          debouncedSearchOptions(normalizeTag(query()), true);
          setShouldOpenOptionsAfterSearch(true);
        });
        return;
      }

      if (query().trim()) {
        debouncedSearchOptions(normalizeTag(query()));
        setShouldOpenOptionsAfterSearch(true);
      }
    },
    handleEmptyInputBackspace(
      inputValue: string,
      hiddenTagCount: number,
      repeat: boolean,
      now: number,
    ) {
      if (config.disabled() || inputValue.length || !config.value().length) {
        lastEmptyInputBackspaceAt = undefined;
        return false;
      }

      if (repeat) {
        return true;
      }

      const isDoubleBackspace =
        lastEmptyInputBackspaceAt !== undefined &&
        now - lastEmptyInputBackspaceAt <= DOUBLE_BACKSPACE_MS;
      lastEmptyInputBackspaceAt = isDoubleBackspace ? undefined : now;

      if (!isDoubleBackspace) {
        return true;
      }

      if (hiddenTagCount > 0 && !isCollapsedOpen()) {
        cancelSearch();
        setShouldOpenOptionsAfterSearch(false);
        setDropdownMode('collapsed');
        return true;
      }

      removeLastTag();
      return true;
    },
    moveFocusedOption(direction: -1 | 1) {
      lastEmptyInputBackspaceAt = undefined;
      const currentOptions = options();
      if (config.disabled() || !currentOptions.length || isCollapsedOpen()) {
        return false;
      }

      setShouldOpenOptionsAfterSearch(true);
      setArrowScrolling(true);
      setFocusedOptionIndex((currentIndex) => {
        if (currentIndex === null) {
          return direction === 1 ? 0 : currentOptions.length - 1;
        }

        return (currentIndex + direction + currentOptions.length) % currentOptions.length;
      });
      return true;
    },
    focusOption(index: number) {
      setArrowScrolling(false);
      setFocusedOptionIndex(index);
    },
    resetBackspace() {
      lastEmptyInputBackspaceAt = undefined;
    },
  };
}
