import { A } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  Edit3,
  FileText,
  Heart,
  Library,
  Plus,
  Search,
  Trash2,
} from "lucide-solid";
import {
  type Book,
  type BookSort,
  createBooksQuery,
  createDeleteBookCoverMutation,
  createDeleteBookMutation,
  createUpdateBookMutation,
  createUploadBookCoverMutation,
  getBookCoverUrl,
} from "@/api/books";
import Button from "@/components/common/Button/Button";
import InputContainer from "@/components/common/InputContainer/InputContainer";
import TagsSelect from "@/components/common/TagsSelect/TagsSelect";
import TextInput from "@/components/common/TextInput/TextInput";
import AppLayout from "@/components/layouts/AppLayout/AppLayout";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./LibraryPage.module.scss";

const pageLimit = 24;

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return fallback;
}

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

function BookCover(props: {
  book: Book;
}) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    props.book.id;
    setFailed(false);
  });

  return (
    <div class={styles.cover}>
      <Show
        when={!failed()}
        fallback={
          <div class={styles.coverFallback}>
            <FileText />
            <span>{props.book.format.toUpperCase()}</span>
          </div>
        }
      >
        <img
          src={getBookCoverUrl(props.book.id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </Show>
    </div>
  );
}

function EditBookDialog(props: {
  book: Book;
  tagOptions: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = createSignal(props.book.title);
  const [tags, setTags] = createSignal<string[]>(props.book.tags);
  const [favorite, setFavorite] = createSignal(props.book.favorite);
  const [error, setError] = createSignal("");
  const updateBookMutation = createUpdateBookMutation();
  const uploadCoverMutation = createUploadBookCoverMutation();
  const deleteCoverMutation = createDeleteBookCoverMutation();
  let coverInputEl: HTMLInputElement | undefined;

  const busy = () =>
    updateBookMutation.isPending || uploadCoverMutation.isPending || deleteCoverMutation.isPending;

  const handleSave = () => {
    setError("");
    updateBookMutation.mutate(
      {
        bookId: props.book.id,
        patch: {
          title: title().trim(),
          tags: tags(),
          favorite: favorite(),
        },
      },
      {
        onSuccess: props.onClose,
        onError: (nextError) => setError(errorMessage(nextError, t("requestFailedTryAgain"))),
      },
    );
  };

  const handleCoverChange = (file: File | undefined) => {
    if (!file) {
      return;
    }

    setError("");
    uploadCoverMutation.mutate(
      { bookId: props.book.id, file },
      {
        onError: (nextError) => setError(errorMessage(nextError, t("requestFailedTryAgain"))),
      },
    );
  };

  const handleDeleteCover = () => {
    setError("");
    deleteCoverMutation.mutate(props.book.id, {
      onError: (nextError) => setError(errorMessage(nextError, t("requestFailedTryAgain"))),
    });
  };

  return (
    <div class={styles.dialogOverlay} onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <section class={styles.dialog} role="dialog" aria-modal="true" aria-label={t("editBook")}>
        <header class={styles.dialogHeader}>
          <h2>{t("editBook")}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            {t("close")}
          </Button>
        </header>

        <div class={styles.dialogBody}>
          <InputContainer label={t("title")} filled={Boolean(title())}>
            <TextInput value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
          </InputContainer>

          <InputContainer label={t("tags")} filled={tags().length > 0}>
            <TagsSelect value={tags()} options={props.tagOptions} onChange={setTags} />
          </InputContainer>

          <label class={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={favorite()}
              onChange={(event) => setFavorite(event.currentTarget.checked)}
            />
            <span>{t("favorite")}</span>
          </label>

          <div class={styles.coverActions}>
            <input
              ref={coverInputEl}
              class={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => handleCoverChange(event.currentTarget.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              loading={uploadCoverMutation.isPending}
              onClick={() => coverInputEl?.click()}
            >
              {t("uploadCover")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={deleteCoverMutation.isPending}
              onClick={handleDeleteCover}
            >
              {t("deleteCover")}
            </Button>
          </div>

          <Show when={error()}>
            <p class={styles.error}>{error()}</p>
          </Show>
        </div>

        <footer class={styles.dialogFooter}>
          <Button type="button" variant="secondary" onClick={props.onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" loading={busy()} onClick={handleSave}>
            {t("save")}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function LibraryPage() {
  const { t } = useI18n();
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<BookSort>("updated_at_desc");
  const [favoriteFilter, setFavoriteFilter] = createSignal<"all" | "favorite" | "regular">("all");
  const [selectedTags, setSelectedTags] = createSignal<string[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [editingBook, setEditingBook] = createSignal<Book>();
  const updateBookMutation = createUpdateBookMutation();
  const deleteBookMutation = createDeleteBookMutation();
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
    q: search().trim(),
  }));
  const books = createMemo(() => booksQuery.data?.items ?? []);
  const tagOptions = createMemo(() => uniqueTags(books(), selectedTags()));
  const pageStart = createMemo(() => Math.min(offset() + 1, booksQuery.data?.total ?? 0));
  const pageEnd = createMemo(() => Math.min(offset() + pageLimit, booksQuery.data?.total ?? 0));
  const canGoBack = createMemo(() => offset() > 0);
  const canGoForward = createMemo(() => offset() + pageLimit < (booksQuery.data?.total ?? 0));

  const resetToFirstPage = () => setOffset(0);

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
          <InputContainer label={t("searchBooks")} filled={Boolean(search())} endContent={<Search />}>
            <TextInput
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                resetToFirstPage();
              }}
            />
          </InputContainer>

          <InputContainer label={t("sort")} filled={Boolean(sort())}>
            <select
              class={styles.selectControl}
              value={sort()}
              onChange={(event) => {
                setSort(event.currentTarget.value as BookSort);
                resetToFirstPage();
              }}
            >
              <option value="updated_at_desc">{t("updatedNewest")}</option>
              <option value="created_at_desc">{t("addedNewest")}</option>
              <option value="title_asc">{t("titleAZ")}</option>
              <option value="title_desc">{t("titleZA")}</option>
              <option value="progress_desc">{t("progressHigh")}</option>
              <option value="progress_asc">{t("progressLow")}</option>
            </select>
          </InputContainer>

          <InputContainer label={t("favoritesFilter")} filled>
            <div class={styles.segmented} role="group" aria-label={t("favoritesFilter")}>
              <button
                type="button"
                classList={{ [styles.activeSegment]: favoriteFilter() === "all" }}
                onClick={() => {
                  setFavoriteFilter("all");
                  resetToFirstPage();
                }}
              >
                {t("all")}
              </button>
              <button
                type="button"
                classList={{ [styles.activeSegment]: favoriteFilter() === "favorite" }}
                onClick={() => {
                  setFavoriteFilter("favorite");
                  resetToFirstPage();
                }}
              >
                {t("favorites")}
              </button>
              <button
                type="button"
                classList={{ [styles.activeSegment]: favoriteFilter() === "regular" }}
                onClick={() => {
                  setFavoriteFilter("regular");
                  resetToFirstPage();
                }}
              >
                {t("other")}
              </button>
            </div>
          </InputContainer>

          <InputContainer label={t("tags")} filled={selectedTags().length > 0}>
            <TagsSelect
              value={selectedTags()}
              options={tagOptions()}
              onChange={(nextTags) => {
                setSelectedTags(nextTags);
                resetToFirstPage();
              }}
            />
          </InputContainer>
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
            <For each={books()}>
              {(book) => (
                <article class={styles.bookCard}>
                  <A class={styles.coverLink} href={`/reader/${book.id}`}>
                    <BookCover book={book} />
                  </A>
                  <div class={styles.bookContent}>
                    <div class={styles.bookTitleRow}>
                      <h2>
                        <A href={`/reader/${book.id}`}>{book.title}</A>
                      </h2>
                      <div class={styles.bookActions}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label={book.favorite ? t("removeFromFavorites") : t("addToFavorites")}
                          iconStart={<Heart />}
                          classList={{ [styles.favoriteActive]: book.favorite }}
                          onClick={() => handleFavoriteToggle(book)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label={t("edit")}
                          iconStart={<Edit3 />}
                          onClick={() => setEditingBook(book)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label={t("delete")}
                          iconStart={<Trash2 />}
                          onClick={() => handleDelete(book)}
                        />
                      </div>
                    </div>

                    <div class={styles.progress}>
                      <span style={{ width: `${book.progress_percent}%` }} />
                    </div>

                    <Show when={book.tags.length > 0}>
                      <div class={styles.cardTags}>
                        <For each={book.tags}>{(tag) => <span>{tag}</span>}</For>
                      </div>
                    </Show>
                  </div>
                </article>
              )}
            </For>
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
