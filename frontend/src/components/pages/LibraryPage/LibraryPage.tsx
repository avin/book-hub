import { A } from "@solidjs/router";
import { batch, createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js";
import { Library, Plus, Search } from "lucide-solid";
import {
  type Book,
  type BookSort,
  createBooksQuery,
  createDeleteBookMutation,
  createUpdateBookMutation,
} from "@/api/books";
import Button from "@/components/common/Button/Button";
import InputContainer from "@/components/common/InputContainer/InputContainer";
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

function uniqueTags(books: Book[], selectedTags: string[]) {
  const tags = new Map<string, string>();

  for (const tag of selectedTags) {
    tags.set(tag.toLowerCase(), tag);
  }
  for (const book of books) {
    for (const tag of book.tags) {
      tags.set(tag.toLowerCase(), tag);
    }
  }

  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

function LibraryPage() {
  const { t } = useI18n();
  const [search, setSearch] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal("");
  const [sort, setSort] = createSignal<BookSort>("created_at_desc");
  const [favoriteFilter, setFavoriteFilter] = createSignal<"all" | "favorite" | "regular">("all");
  const [selectedTags, setSelectedTags] = createSignal<string[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [editingBook, setEditingBook] = createSignal<Book>();
  const updateBookMutation = createUpdateBookMutation();
  const deleteBookMutation = createDeleteBookMutation();
  const resetToFirstPage = () => setOffset(0);

  createEffect(() => {
    const nextSearch = search();
    const timeoutId = window.setTimeout(() => {
      batch(() => {
        setDebouncedSearch(nextSearch);
        resetToFirstPage();
      });
    }, searchDebounceMs);

    onCleanup(() => clearTimeout(timeoutId));
  });

  const booksQuery = createBooksQuery(() => ({
    limit: pageLimit,
    offset: offset(),
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
  const books = createMemo(() => booksQuery.data?.items ?? []);
  const tagOptions = createMemo(() => uniqueTags(books(), selectedTags()));
  const pageStart = createMemo(() => Math.min(offset() + 1, booksQuery.data?.total ?? 0));
  const pageEnd = createMemo(() => Math.min(offset() + pageLimit, booksQuery.data?.total ?? 0));
  const canGoBack = createMemo(() => offset() > 0);
  const canGoForward = createMemo(() => offset() + pageLimit < (booksQuery.data?.total ?? 0));

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
            <h1>{t("yourBooks")}</h1>
          </div>
          <A href="/upload" class={styles.uploadLink}>
            <Plus />
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
                resetToFirstPage();
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
                  resetToFirstPage();
                }}
                onFavoriteFilterChange={(nextFavoriteFilter) => {
                  setFavoriteFilter(nextFavoriteFilter);
                  resetToFirstPage();
                }}
              />
            </InputContainer>
          </div>
        </section>

        <Show when={booksQuery.isLoading}>
          <div class={styles.state}>{t("loading")}</div>
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

        <Show when={(booksQuery.data?.total ?? 0) > pageLimit}>
          <footer class={styles.pagination}>
            <span>{pageStart()}-{pageEnd()} / {booksQuery.data?.total}</span>
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canGoBack()}
                onClick={() => setOffset(Math.max(0, offset() - pageLimit))}
              >
                {t("back")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canGoForward()}
                onClick={() => setOffset(offset() + pageLimit)}
              >
                {t("forward")}
              </Button>
            </div>
          </footer>
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
