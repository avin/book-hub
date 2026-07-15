import { createEffect, createSignal, onCleanup } from 'solid-js';
import { getRecentTagsPreference, setRecentTagsPreference } from '@/storage/browserPreferences';
import { mergeRecentTags, normalizeTag, normalizeTags, sortTagsByRecent } from './tagUtils';

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
  const [options, setOptions] = createSignal<string[]>([]);
  const [dropdownMode, setDropdownMode] = createSignal<'options' | 'collapsed' | null>(null);
  const [focusedOptionIndex, setFocusedOptionIndex] = createSignal<number | null>(null);
  const [arrowScrolling, setArrowScrolling] = createSignal(false);
  const knownOptions: string[] = [];
  const optionSearch = createTagOptionSearch();
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let shouldOpenOptionsAfterSearch = false;
  let lastEmptyInputBackspaceAt = 0;

  const isOptionsOpen = () => dropdownMode() === 'options';
  const isCollapsedOpen = () => dropdownMode() === 'collapsed';
  const isDropdownOpen = () => dropdownMode() !== null;

  const loadRecentTags = () => normalizeTags(getRecentTagsPreference());

  const closeDropdown = () => {
    shouldOpenOptionsAfterSearch = false;
    setDropdownMode(null);
  };

  const normalizeOptions = (nextOptions: string[]) => {
    const seen = new Set<string>();
    const selectedTags = config.value();
    const availableOptions = nextOptions.map(normalizeTag).filter((option) => {
      if (!option || selectedTags.includes(option) || seen.has(option)) {
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
    const localOptions = [...(config.options() ?? []), ...knownOptions];

    return localOptions.filter((option) => {
      if (!normalizedQuery) {
        return true;
      }

      return option.toLowerCase().includes(normalizedQuery);
    });
  };

  const searchOptions = async (searchQuery: string) => {
    const nextOptions = await optionSearch.run(() => {
      const onSearchOptions = config.onSearchOptions();
      return onSearchOptions ? onSearchOptions(searchQuery) : searchLocalOptions(searchQuery);
    });

    if (!nextOptions) {
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

    optionSearch.cancel();
  };

  const updateRecentTags = (addedTags: string[]) => {
    if (!addedTags.length) {
      return;
    }

    setRecentTagsPreference(mergeRecentTags(loadRecentTags(), addedTags, MAX_RECENT_TAGS));
  };

  const addTag = (tag: string) => {
    const normalized = normalizeTag(tag);
    const selectedTags = config.value();

    if (!normalized || selectedTags.includes(normalized)) {
      return;
    }

    config.onChange([...selectedTags, normalized]);
    updateRecentTags([normalized]);
    setQuery('');
    closeDropdown();
  };

  const removeTag = (tag: string) => {
    lastEmptyInputBackspaceAt = 0;
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
    cancelSearch();

    const normalized = normalizeTag(query());
    if (!normalized) {
      closeDropdown();
      return;
    }

    const selectedTags = config.value();
    if (!selectedTags.includes(normalized)) {
      config.onChange([...selectedTags, normalized]);
      updateRecentTags([normalized]);
    }

    setQuery('');
    closeDropdown();
  };

  createEffect(() => {
    if (!isOptionsOpen()) {
      setFocusedOptionIndex(null);
    }
  });

  onCleanup(cancelSearch);

  return {
    query,
    options,
    focusedOptionIndex,
    arrowScrolling,
    isOptionsOpen,
    isCollapsedOpen,
    isDropdownOpen,
    closeDropdown,
    openOptions() {
      if (config.disabled() || !config.showOptionsOnFocus()) {
        return;
      }

      shouldOpenOptionsAfterSearch = true;
      debouncedSearchOptions(query(), true);
    },
    toggleCollapsedDropdown() {
      shouldOpenOptionsAfterSearch = false;
      setDropdownMode((previousMode) => (previousMode === 'collapsed' ? null : 'collapsed'));
    },
    handleDropdownOpenChange(nextOpen: boolean) {
      if (nextOpen) {
        setDropdownMode('options');
        return;
      }

      closeDropdown();
    },
    addTag,
    removeTag,
    applyTypedInput,
    applyCurrentInput() {
      cancelSearch();

      const focusedIndex = focusedOptionIndex();
      const option = focusedIndex === null ? undefined : options()[focusedIndex];
      if (option) {
        addTag(option);
        return;
      }

      applyTypedInput();
    },
    handleChangeQuery(nextQuery: string) {
      const normalizedQuery = nextQuery.toLowerCase();

      setQuery(normalizedQuery);
      lastEmptyInputBackspaceAt = 0;
      setFocusedOptionIndex(null);
      shouldOpenOptionsAfterSearch = true;
      if (!isOptionsOpen()) {
        setDropdownMode(null);
      }

      debouncedSearchOptions(normalizedQuery);
    },
    handleInputFocus() {
      if (config.disabled()) {
        return;
      }

      shouldOpenOptionsAfterSearch = true;
      if (!isOptionsOpen()) {
        setDropdownMode(null);
      }

      if (config.showOptionsOnFocus()) {
        debouncedSearchOptions(query(), true);
        return;
      }

      if (query().trim()) {
        debouncedSearchOptions(query());
      }
    },
    handleEmptyInputBackspace(
      inputValue: string,
      hiddenTagCount: number,
      repeat: boolean,
      now: number,
    ) {
      if (inputValue.length || !config.value().length) {
        return false;
      }

      if (repeat) {
        return true;
      }

      const isDoubleBackspace = now - lastEmptyInputBackspaceAt <= DOUBLE_BACKSPACE_MS;
      lastEmptyInputBackspaceAt = isDoubleBackspace ? 0 : now;

      if (!isDoubleBackspace) {
        return true;
      }

      if (hiddenTagCount > 0 && !isCollapsedOpen()) {
        shouldOpenOptionsAfterSearch = false;
        setDropdownMode('collapsed');
        return true;
      }

      removeLastTag();
      return true;
    },
    moveFocusedOption(direction: -1 | 1) {
      const currentOptions = options();
      if (!isOptionsOpen() || !currentOptions.length) {
        return false;
      }

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
  };
}
