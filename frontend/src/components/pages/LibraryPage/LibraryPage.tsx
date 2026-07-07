import { A } from "@solidjs/router";
import { createInfiniteQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, Index, onCleanup, onMount, Show } from "solid-js";
import { Library, Search, Upload } from "lucide-solid";
import {
  type Book,
  type BookListResponse,
  type BookQueryRequest,
  type BookSort,
  booksQueryKey,
  createBookTagsQuery,
  createDeleteBookMutation,
  createUpdateBookMutation,
  queryBooks,
} from "@/api/books";
import InputContainer from "@/components/common/InputContainer/InputContainer";
import LoadingScreen from "@/components/common/LoadingScreen/LoadingScreen";
import TagsSelect from "@/components/common/TagsSelect/TagsSelect";
import TextInput from "@/components/common/TextInput/TextInput";
import AppLayout from "@/components/layouts/AppLayout/AppLayout";
import { useI18n } from "@/i18n/I18nProvider";
import BookCard from "./BookCard/BookCard";
import EditBookDialog from "./EditBookDialog/EditBookDialog";
import LibraryFiltersDropdown from "./LibraryFiltersDropdown/LibraryFiltersDropdown";
import styles from "./LibraryPage.module.scss";

const pageLimit = 24;
const searchDebounceMs = 400;

function uniqueTags(existingTags: string[], selectedTags: string[]) {
  const tags = new Map<string, string>();

  for (const tag of existingTags) {
    tags.set(tag, tag);
  }
  for (const tag of selectedTags) {
    tags.set(tag, tag);
  }

  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

function LibraryPage() {
  const { t } = useI18n();
  let loadMoreRef: HTMLDivElement | undefined;
  const [search, setSearch] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal("");
  const [sort, setSort] = createSignal<BookSort>("created_at_desc");
  const [favoriteFilter, setFavoriteFilter] = createSignal<"all" | "favorite" | "regular">("all");
  const [selectedTags, setSelectedTags] = createSignal<string[]>([]);
  const [editingBook, setEditingBook] = createSignal<Book>();
  const updateBookMutation = createUpdateBookMutation();
  const deleteBookMutation = createDeleteBookMutation();
  const bookTagsQuery = createBookTagsQuery();

  createEffect(() => {
    const nextSearch = search();
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(nextSearch);
    }, searchDebounceMs);

    onCleanup(() => clearTimeout(timeoutId));
  });

  const booksQueryRequest = createMemo<BookQueryRequest>(() => ({
    limit: pageLimit,
    offset: 0,
    sort: sort(),
    tags: selectedTags(),
    favorite:
      favoriteFilter() === "favorite"
        ? true
        : favoriteFilter() === "regular"
          ? false
          : null,
    q: debouncedSearch().trim(),
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
      getNextPageParam: (lastPage) => {
        const nextOffset = lastPage.offset + lastPage.items.length;

        return nextOffset < lastPage.total ? nextOffset : undefined;
      },
    };
  });
  const books = createMemo(() => booksQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const tagOptions = createMemo(() => uniqueTags(bookTagsQuery.data?.items ?? [], selectedTags()));
  const booksTotal = createMemo(() => booksQuery.data?.pages[0]?.total);
  const hasActiveFilters = createMemo(
    () => debouncedSearch().trim() !== "" || selectedTags().length > 0 || favoriteFilter() !== "all",
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
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreIfNeeded();
        }
      },
      { root: null, rootMargin: "640px 0px" },
    );

    if (loadMoreRef) {
      observer.observe(loadMoreRef);
    }

    onCleanup(() => observer.disconnect());
  });

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
    if (!window.confirm(t("deleteBookConfirm"))) {
      return;
    }

    deleteBookMutation.mutate(book.id);
  };

  return (
    <AppLayout>
      <section class={styles.library}>
        <header class={styles.header}>
          <div>
            <p class={styles.kicker}>{t("library")}</p>
            <h1>
              {t("yourBooks")}
              <Show when={booksTotal() !== undefined}>
                <span class={styles.booksTotal}>
                  {" - "}
                  {booksTotal()} {hasActiveFilters() ? t("filtered") : t("total")}
                </span>
              </Show>
            </h1>
          </div>
          <A href="/upload" class={styles.uploadLink}>
            <Upload />
            {t("uploadBook")}
          </A>
        </header>

        <section class={styles.toolbar}>
          <InputContainer label={t("searchBooks")} endContent={<Search />}>
            <TextInput
              value={search()}
              placeholder={t("findByTitle")}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
              }}
            />
          </InputContainer>

          <label class={styles.tagsFilter}>
            <span>{t("tags")}</span>
            <TagsSelect
              value={selectedTags()}
              options={tagOptions()}
              placeholder={t("findByTag")}
              onChange={(nextTags) => {
                setSelectedTags(nextTags);
              }}
            />
          </label>

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
          </div>
        </section>

        <Show when={booksQuery.isLoading}>
          <LoadingScreen label={t("loading")} />
        </Show>

        <Show when={booksQuery.isError}>
          <div class={styles.state}>{t("requestFailedTryAgain")}</div>
        </Show>

        <Show when={!booksQuery.isLoading && !booksQuery.isError && books().length === 0}>
          <div class={styles.emptyState}>
            <Library />
            <h2>{t("libraryEmpty")}</h2>
            <A href="/upload">{t("uploadBook")}</A>
          </div>
        </Show>

        <Show when={books().length > 0}>
          <div class={styles.bookList}>
            <Index each={books()}>
              {(book) => (
                <BookCard
                  book={book}
                  onFavoriteToggle={handleFavoriteToggle}
                  onEdit={setEditingBook}
                  onDelete={handleDelete}
                />
              )}
            </Index>
          </div>
        </Show>

        <div ref={loadMoreRef} class={styles.loadMoreSentinel} aria-hidden="true" />

        <Show when={booksQuery.isFetchingNextPage}>
          <div class={styles.loadingMore} role="status" aria-label={t("loading")}>
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
      </section>
    </AppLayout>
  );
}

export default LibraryPage;
