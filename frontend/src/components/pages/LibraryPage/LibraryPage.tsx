import { useLocation, useNavigate } from '@solidjs/router';
import { createInfiniteQuery } from '@tanstack/solid-query';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { LayoutGrid, Library, List, SearchX, Upload, X } from 'lucide-solid';
import {
  type Book,
  type BookListResponse,
  type BookQueryRequest,
  type BookSearchField,
  type BookSort,
  booksQueryKey,
  createBookTagsQuery,
  createUpdateBookMutation,
  queryBooks,
} from '@/api/books';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import TagsSelect from '@/components/common/TagsSelect/TagsSelect';
import { mergeTagOptions } from '@/components/common/TagsSelect/tagUtils';
import { useI18n } from '@/i18n/I18nProvider';
import {
  type LibraryView,
  getLibraryViewPreference,
  setLibraryViewPreference,
} from '@/storage/browserPreferences';
import BookCard from './BookCard/BookCard';
import BookCardGrid from './BookCardGrid/BookCardGrid';
import EditBookDialog from './EditBookDialog/EditBookDialog';
import BookActionDialog from './BookActionDialog/BookActionDialog';
import LibraryFiltersDropdown from './LibraryFiltersDropdown/LibraryFiltersDropdown';
import BookSearchInput from '@/components/common/BookSearchInput/BookSearchInput';
import {
  libraryBookmarkApplication,
  setLibraryBookmarkApplication,
  buildLibraryListStateUrl,
  getDefaultLibraryListState,
  type LibraryFavoriteFilter,
  type LibraryListState,
  readInitialLibraryListState,
  readLibraryListStateFromSearch,
  rememberLibraryListState,
} from './libraryListState';
import styles from './LibraryPage.module.scss';

const pageLimit = 24;
const searchDebounceMs = 400;
const libraryRoutePath = '/library';

function LibraryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  let loadMoreRef: HTMLDivElement | undefined;
  const initialListState = readInitialLibraryListState(location.search);
  const [search, setSearch] = createSignal(initialListState.search);
  const [searchField, setSearchField] = createSignal<BookSearchField>(initialListState.searchField);
  const [debouncedSearch, setDebouncedSearch] = createSignal(initialListState.search);
  const [sort, setSort] = createSignal<BookSort>(initialListState.sort);
  const [favoriteFilter, setFavoriteFilter] = createSignal<LibraryFavoriteFilter>(
    initialListState.favoriteFilter,
  );
  const [selectedTags, setSelectedTags] = createSignal<string[]>(initialListState.tags);
  const [view, setView] = createSignal<LibraryView>(getLibraryViewPreference() ?? 'list');
  const [editingBook, setEditingBook] = createSignal<Book>();
  const [bookAction, setBookAction] = createSignal<{
    book: Book;
    action: 'delete' | 'resetProgress';
  }>();
  const updateBookMutation = createUpdateBookMutation();
  const bookTagsQuery = createBookTagsQuery();

  const applyListState = (state: LibraryListState, options?: { immediateSearch?: boolean }) => {
    setSearch(state.search);
    setSearchField(state.searchField);
    setSort(state.sort);
    setFavoriteFilter(state.favoriteFilter);
    setSelectedTags(state.tags);

    if (options?.immediateSearch) {
      setDebouncedSearch(state.search);
    }
  };

  // Consume a pending bookmark even when it arrived before this lazy page mounted.
  createEffect(
    on(libraryBookmarkApplication, (state) => {
      if (!state) return;
      batch(() => {
        applyListState(state, { immediateSearch: true });
        setLibraryBookmarkApplication(undefined);
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }),
  );

  createEffect(() => {
    const nextSearch = search();
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(nextSearch);
    }, searchDebounceMs);

    onCleanup(() => clearTimeout(timeoutId));
  });

  createEffect(() => {
    rememberLibraryListState({
      search: search(),
      searchField: searchField(),
      sort: sort(),
      favoriteFilter: favoriteFilter(),
      tags: selectedTags(),
    });
  });

  createEffect(() => {
    const state = {
      search: debouncedSearch(),
      searchField: searchField(),
      sort: sort(),
      favoriteFilter: favoriteFilter(),
      tags: selectedTags(),
    };

    const nextUrl = buildLibraryListStateUrl(state, {
      pathname: libraryRoutePath,
      search: '',
      hash: '',
    });
    // The browser URL is updated only after the router's transition commits.
    const currentUrl = untrack(() => `${location.pathname}${location.search}${location.hash}`);

    if (nextUrl !== currentUrl) {
      navigate(nextUrl, { replace: true, scroll: false });
    }
  });

  const booksQueryRequest = createMemo<BookQueryRequest>(() => ({
    limit: pageLimit,
    offset: 0,
    sort: sort(),
    tags: selectedTags(),
    favorite:
      favoriteFilter() === 'favorite' ? true : favoriteFilter() === 'regular' ? false : null,
    q: debouncedSearch().trim(),
    search_field: searchField(),
  }));

  const booksQuery = createInfiniteQuery<
    BookListResponse,
    Error,
    { pages: BookListResponse[]; pageParams: number[] },
    [string, BookQueryRequest],
    number
  >(() => {
    const request = booksQueryRequest();

    return {
      queryKey: [booksQueryKey[0], request],
      queryFn: ({ pageParam }) =>
        queryBooks({
          ...request,
          offset: pageParam,
        }),
      initialPageParam: 0,
      placeholderData: (previousData) => previousData,
      getNextPageParam: (lastPage) => {
        const nextOffset = lastPage.offset + lastPage.items.length;

        return nextOffset < lastPage.total ? nextOffset : undefined;
      },
    };
  });
  const books = createMemo(() => booksQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const bookIds = createMemo(() => books().map((book) => book.id), [], {
    equals: (previous, next) =>
      previous.length === next.length && previous.every((id, index) => id === next[index]),
  });
  const booksById = createMemo(() => new Map(books().map((book) => [book.id, book])));
  const tagOptions = createMemo(() =>
    mergeTagOptions(bookTagsQuery.data?.items ?? [], selectedTags()),
  );
  const booksTotal = createMemo(() => booksQuery.data?.pages[0]?.total);
  const showInitialLoading = createMemo(() => booksQuery.isLoading && books().length === 0);
  const hasActiveFilters = createMemo(
    () =>
      debouncedSearch().trim() !== '' || selectedTags().length > 0 || favoriteFilter() !== 'all',
  );
  const canLoadMore = createMemo(
    () =>
      Boolean(booksQuery.hasNextPage) &&
      !booksQuery.isLoading &&
      !booksQuery.isError &&
      !booksQuery.isFetchingNextPage,
  );

  const loadMoreIfNeeded = () => {
    if (!loadMoreRef || !canLoadMore()) {
      return;
    }

    const bounds = loadMoreRef.getBoundingClientRect();

    if (bounds.top <= window.innerHeight + 640) {
      void booksQuery.fetchNextPage();
    }
  };

  createEffect(() => {
    const loadedCount = books().length;

    if (loadedCount >= 0 && canLoadMore()) {
      loadMoreIfNeeded();
    }
  });

  onMount(() => {
    const handlePopState = () => {
      if (window.location.pathname.replace(/\/+$/, '') !== `${import.meta.env.BASE_URL}library`)
        return;
      applyListState(
        readLibraryListStateFromSearch(window.location.search) ?? getDefaultLibraryListState(),
        {
          immediateSearch: true,
        },
      );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreIfNeeded();
        }
      },
      { root: null, rootMargin: '640px 0px' },
    );

    if (loadMoreRef) {
      observer.observe(loadMoreRef);
    }

    window.addEventListener('popstate', handlePopState);

    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('popstate', handlePopState);
    });
  });

  const handleTagSelect = (tag: string) => {
    setSelectedTags((tags) => (tags.includes(tag) ? tags : [...tags, tag]));
  };

  const handleFavoriteToggle = (book: Book) => {
    updateBookMutation.mutate({
      bookId: book.id,
      patch: {
        favorite: !book.favorite,
      },
      invalidateBooks: false,
    });
  };

  const handleDelete = (book: Book) => {
    setBookAction({ book, action: 'delete' });
  };

  const handleResetProgress = (book: Book) => {
    setBookAction({ book, action: 'resetProgress' });
  };

  const resetFilters = () => {
    const defaultState = getDefaultLibraryListState();

    applyListState(
      {
        ...defaultState,
        sort: sort(),
      },
      { immediateSearch: true },
    );
  };

  return (
    <section class={styles.library}>
      <header class={styles.header}>
        <div>
          <h1>
            {t('yourBooks')}
            <Show when={booksTotal() !== undefined}>
              <span
                class={styles.booksTotal}
                classList={{ [styles.booksTotalFiltered]: hasActiveFilters() }}
              >
                {' - '}
                {booksTotal()} {hasActiveFilters() ? t('filtered') : t('total')}
              </span>
              <Show when={hasActiveFilters()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  destructive
                  iconOnly
                  class={styles.resetFilters}
                  iconStart={<X />}
                  aria-label={t('resetFilters')}
                  title={t('resetFilters')}
                  onClick={resetFilters}
                />
              </Show>
            </Show>
          </h1>
        </div>
        <Button href="/upload" class={styles.headerUpload} iconStart={<Upload />}>
          {t('uploadBook')}
        </Button>
      </header>

      <section class={styles.toolbar}>
        <InputContainer label={t('searchBooks')}>
          <BookSearchInput
            value={search()}
            onChange={setSearch}
            searchField={searchField()}
            onSearchFieldChange={setSearchField}
            onClear={() => {
              setSearch('');
              setDebouncedSearch('');
            }}
          />
        </InputContainer>

        <div class={styles.secondaryFilters}>
          <InputContainer label={t('tags')}>
            <TagsSelect
              value={selectedTags()}
              options={tagOptions()}
              placeholder={t('findByTag')}
              onChange={(nextTags) => {
                setSelectedTags(nextTags);
              }}
            />
          </InputContainer>

          <div class={styles.filtersField}>
            <InputContainer label="">
              <LibraryFiltersDropdown
                sort={sort()}
                favoriteFilter={favoriteFilter()}
                onSortChange={(nextSort) => {
                  setSort(nextSort);
                }}
                onFavoriteFilterChange={(nextFavoriteFilter) => {
                  setFavoriteFilter(nextFavoriteFilter);
                }}
              />
            </InputContainer>

            <div class={styles.viewToggle} role="group" aria-label={t('bookActions')}>
              <Button
                type="button"
                variant={view() === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                iconOnly
                aria-label={t('viewList')}
                title={t('viewList')}
                aria-pressed={view() === 'list'}
                onClick={() => {
                  setView('list');
                  setLibraryViewPreference('list');
                }}
                iconStart={<List />}
              />
              <Button
                type="button"
                variant={view() === 'grid' ? 'secondary' : 'ghost'}
                size="sm"
                iconOnly
                aria-label={t('viewGrid')}
                title={t('viewGrid')}
                aria-pressed={view() === 'grid'}
                onClick={() => {
                  setView('grid');
                  setLibraryViewPreference('grid');
                }}
                iconStart={<LayoutGrid />}
              />
            </div>
          </div>
        </div>
      </section>

      <Show when={showInitialLoading()}>
        <LoadingScreen class={styles.listLoading} label={t('loading')} />
      </Show>

      <Show when={booksQuery.isError && books().length === 0}>
        <div class={styles.state}>
          <p>{t('requestFailedTryAgain')}</p>
          <Button type="button" variant="secondary" onClick={() => void booksQuery.refetch()}>
            {t('tryAgain')}
          </Button>
        </div>
      </Show>

      <Show when={!showInitialLoading() && !booksQuery.isError && books().length === 0}>
        <Show
          when={hasActiveFilters()}
          fallback={
            <div class={styles.emptyState}>
              <Library />
              <h2>{t('libraryEmpty')}</h2>
              <Button href="/upload">{t('uploadBook')}</Button>
            </div>
          }
        >
          <div class={styles.emptyState}>
            <SearchX />
            <h2>{t('noBooksMatchFilters')}</h2>
            <Button type="button" variant="secondary" onClick={resetFilters}>
              {t('resetFilters')}
            </Button>
          </div>
        </Show>
      </Show>

      <Show when={books().length > 0}>
        <div
          class={styles.bookList}
          classList={{
            [styles.bookListGrid]: view() === 'grid',
            [styles.bookListStale]: booksQuery.isPlaceholderData,
          }}
        >
          <For each={bookIds()}>
            {(bookId) => {
              const book = createMemo<Book>(
                (previous) => booksById().get(bookId) ?? previous,
                booksById().get(bookId)!,
              );

              return (
                <Show
                  when={view() === 'grid'}
                  fallback={
                    <BookCard
                      book={book}
                      onTagSelect={handleTagSelect}
                      onFavoriteToggle={handleFavoriteToggle}
                      onEdit={setEditingBook}
                      onDelete={handleDelete}
                      onResetProgress={handleResetProgress}
                    />
                  }
                >
                  <BookCardGrid
                    book={book}
                    onTagSelect={handleTagSelect}
                    onFavoriteToggle={handleFavoriteToggle}
                    onEdit={setEditingBook}
                    onDelete={handleDelete}
                    onResetProgress={handleResetProgress}
                  />
                </Show>
              );
            }}
          </For>
        </div>
      </Show>

      <div ref={loadMoreRef} class={styles.loadMoreSentinel} aria-hidden="true" />

      <Show when={booksQuery.isFetchingNextPage}>
        <div class={styles.loadingMore} role="status" aria-label={t('loading')}>
          <span class={styles.loadingMoreSpinner} aria-hidden="true" />
        </div>
      </Show>

      <Show when={editingBook()}>
        {(book) => (
          <EditBookDialog
            book={book()}
            tagOptions={tagOptions()}
            onClose={() => setEditingBook(undefined)}
          />
        )}
      </Show>
      <Show when={bookAction()}>
        {(selection) => (
          <BookActionDialog
            book={selection().book}
            action={selection().action}
            onClose={() => setBookAction(undefined)}
          />
        )}
      </Show>
    </section>
  );
}

export default LibraryPage;
