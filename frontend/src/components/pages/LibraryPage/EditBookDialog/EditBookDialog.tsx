import { createSignal, Show } from "solid-js";
import {
  type Book,
  createDeleteBookCoverMutation,
  createUpdateBookMutation,
  createUploadBookCoverMutation,
} from "@/api/books";
import Button from "@/components/common/Button/Button";
import InputContainer from "@/components/common/InputContainer/InputContainer";
import TagsSelect from "@/components/common/TagsSelect/TagsSelect";
import TextInput from "@/components/common/TextInput/TextInput";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./EditBookDialog.module.scss";

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return fallback;
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
          <InputContainer label={t("title")}>
            <TextInput value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
          </InputContainer>

          <label class={styles.fieldLabel}>
            <span>{t("tags")}</span>
            <TagsSelect value={tags()} options={props.tagOptions} onChange={setTags} />
          </label>

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

export default EditBookDialog;
