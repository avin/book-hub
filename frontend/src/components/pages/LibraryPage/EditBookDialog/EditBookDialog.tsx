import { useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { ImagePlus, X } from "lucide-solid";
import {
  booksQueryKey,
  type Book,
  createUpdateBookMutation,
  deleteBookCover,
  getBookCoverUrl,
  uploadBookCover,
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

// Pending cover change staged locally until the user clicks "Save".
// Nothing is sent to the backend until Save.
// - "upload" keeps the chosen File; preview comes from an object URL.
// - "delete" marks the cover for removal.
type PendingCover =
  | { kind: "upload"; file: File; previewUrl: string }
  | { kind: "delete" };

function revokePending(state: PendingCover | undefined) {
  if (state?.kind === "upload") {
    URL.revokeObjectURL(state.previewUrl);
  }
}

function EditBookDialog(props: {
  book: Book;
  tagOptions: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [title, setTitle] = createSignal(props.book.title);
  const [tags, setTags] = createSignal<string[]>(props.book.tags);
  const [error, setError] = createSignal("");
  const [pendingCover, setPendingCover] = createSignal<PendingCover | undefined>(undefined);
  const [saving, setSaving] = createSignal(false);
  const updateBookMutation = createUpdateBookMutation();
  let coverInputEl: HTMLInputElement | undefined;

  // Release any staged object URL when the dialog unmounts without saving.
  onCleanup(() => revokePending(pendingCover()));

  // Does the cover area show an image right now (server cover or staged upload)?
  const coverVisible = createMemo(() => pendingCover()?.kind !== "delete");

  // What the cover preview shows: staged upload's object URL, else the server cover.
  const previewSrc = () => {
    const pending = pendingCover();
    return pending?.kind === "upload" ? pending.previewUrl : getBookCoverUrl(props.book.id);
  };

  const busy = () => saving() || updateBookMutation.isPending;

  const openCoverPicker = () => {
    if (!busy()) {
      coverInputEl?.click();
    }
  };

  const handleCoverKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCoverPicker();
    }
  };

  const handleCoverChange = (file: File | undefined) => {
    if (busy() || !file) {
      return;
    }

    setError("");
    revokePending(pendingCover());
    setPendingCover({ kind: "upload", file, previewUrl: URL.createObjectURL(file) });
  };

  const handleDeleteCover = (event: MouseEvent) => {
    // The cover area opens the file picker on click; stop the delete button
    // click from also triggering that.
    event.stopPropagation();
    if (busy()) {
      return;
    }

    setError("");
    revokePending(pendingCover());
    setPendingCover({ kind: "delete" });
  };

  const handleImgError = () => {
    // Server has no cover and nothing is staged → show placeholder.
    if (!pendingCover()) {
      setPendingCover({ kind: "delete" });
    }
  };

  const handleSave = async () => {
    if (busy()) {
      return;
    }

    const nextTitle = title().trim();
    if (!nextTitle) {
      setError(t("fillField"));
      return;
    }

    setError("");
    setSaving(true);

    try {
      // 1. Persist metadata (title/tags/favorite). The mutation keeps the book
      //    cache in sync and returns the updated book.
      await updateBookMutation.mutateAsync({
        bookId: props.book.id,
        patch: {
          title: nextTitle,
          tags: tags(),
          favorite: props.book.favorite,
        },
      });

      // 2. Apply staged cover change (if any). The cover endpoints return 204
      //    (no body) and bump updated_at on the server, so we refetch the book
      //    and the library list to pick up the fresh updated_at, which is used
      //    as a cover-image cache-buster.
      const pending = pendingCover();
      if (pending?.kind === "upload") {
        await uploadBookCover(props.book.id, pending.file);
      } else if (pending?.kind === "delete") {
        await deleteBookCover(props.book.id);
      }

      if (pending) {
        await queryClient.invalidateQueries({ queryKey: ["book", props.book.id] });
        await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      }

      props.onClose();
    } catch (nextError) {
      setError(errorMessage(nextError, t("requestFailedTryAgain")));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    revokePending(pendingCover());
    props.onClose();
  };

  return (
    <div class={styles.dialogOverlay} onClick={(event) => event.target === event.currentTarget && handleClose()}>
      <section class={styles.dialog} role="dialog" aria-modal="true" aria-label={t("editBook")}>
        <header class={styles.dialogHeader}>
          <h2>{t("editBook")}</h2>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label={t("close")}
            title={t("close")}
            onClick={handleClose}
            iconStart={<X />}
          />
        </header>

        <div class={styles.dialogBody}>
          <div class={styles.coverColumn}>
            <div
              class={styles.coverWrapper}
              role="button"
              tabindex={busy() ? -1 : 0}
              aria-label={t("uploadCover")}
              onClick={openCoverPicker}
              onKeyDown={handleCoverKey}
            >
              <span class={styles.coverPreview}>
                <Show
                  when={coverVisible()}
                  fallback={
                    <span class={styles.coverPlaceholder}>
                      <ImagePlus />
                    </span>
                  }
                >
                  <img src={previewSrc()} alt="" onError={handleImgError} />
                </Show>
              </span>

              {/* Decorative hint shown on hover; the whole area is clickable. */}
              <span class={styles.coverHoverIcon} aria-hidden="true">
                <ImagePlus />
              </span>

              <Show when={coverVisible()}>
                <button
                  type="button"
                  class={styles.coverRemove}
                  aria-label={t("deleteCover")}
                  title={t("deleteCover")}
                  disabled={busy()}
                  onClick={handleDeleteCover}
                >
                  <X />
                </button>
              </Show>
            </div>

            <input
              ref={coverInputEl}
              class={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                handleCoverChange(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </div>

          <div class={styles.fields}>
            <InputContainer label={t("title")}>
              <TextInput
                value={title()}
                onInput={(event) => {
                  setTitle(event.currentTarget.value);
                  setError("");
                }}
              />
            </InputContainer>

            <InputContainer label={t("tags")}>
              <TagsSelect value={tags()} options={props.tagOptions} onChange={setTags} />
            </InputContainer>

            <Show when={error()}>
              <p class={styles.error}>{error()}</p>
            </Show>
          </div>
        </div>

        <footer class={styles.dialogFooter}>
          <Button type="button" variant="secondary" onClick={handleClose}>
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
