import { useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, Index, onCleanup, Show } from "solid-js";
import { FileUp, ImagePlus, ScanText, Trash2, Upload } from "lucide-solid";
import { type Book, booksQueryKey, createBooksQuery, uploadBook, uploadBookCover } from "@/api/books";
import Button from "@/components/common/Button/Button";
import InputContainer from "@/components/common/InputContainer/InputContainer";
import TagsSelect from "@/components/common/TagsSelect/TagsSelect";
import TextInput from "@/components/common/TextInput/TextInput";
import AppLayout from "@/components/layouts/AppLayout/AppLayout";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./UploadPage.module.scss";

type CoverStatus = "pending" | "ready" | "missing" | "failed";
type UploadStatus = "idle" | "uploading" | "done" | "failed";

type BookDraft = {
  id: string;
  file: File;
  title: string;
  tags: string[];
  coverFile?: File;
  coverPreviewUrl?: string;
  coverSource?: "auto" | "manual";
  coverStatus: CoverStatus;
  coverError?: string;
  titleExtracting: boolean;
  titleError?: string;
  uploadStatus: UploadStatus;
  uploadError?: string;
  uploadedBookId?: string;
};

const tagOptionsLimit = 200;
let coverExtractionModule: Promise<typeof import("./coverExtraction")> | undefined;

function loadCoverExtraction() {
  coverExtractionModule ??= import("./coverExtraction");

  return coverExtractionModule;
}

function uniqueTags(books: Book[], drafts: BookDraft[]) {
  const tags = new Map<string, string>();

  for (const book of books) {
    for (const tag of book.tags) {
      tags.set(tag.toLowerCase(), tag);
    }
  }
  for (const draft of drafts) {
    for (const tag of draft.tags) {
      tags.set(tag.toLowerCase(), tag);
    }
  }

  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

function titleFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "");
}

function isSupportedBookFile(file: File) {
  const fileName = file.name.toLowerCase();
  return file.type === "application/pdf" || fileName.endsWith(".pdf") || fileName.endsWith(".fb2");
}

function createDraftId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return fallback;
}

function revokePreviewUrl(draft: BookDraft) {
  if (draft.coverPreviewUrl) {
    URL.revokeObjectURL(draft.coverPreviewUrl);
  }
}

function UploadPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = createSignal<BookDraft[]>([]);
  const [dragActive, setDragActive] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal("");
  let fileInputEl: HTMLInputElement | undefined;
  const coverInputByDraftId = new Map<string, HTMLInputElement>();
  const booksQuery = createBooksQuery(() => ({
    limit: tagOptionsLimit,
    offset: 0,
    sort: "created_at_desc",
    tags: [],
    favorite: null,
    q: "",
  }));

  const selectedBooksText = createMemo(() => {
    const count = drafts().length;
    return count > 0 ? t("booksSelected").replace("{count}", String(count)) : t("fileNotSelected");
  });
  const tagOptions = createMemo(() => uniqueTags(booksQuery.data?.items ?? [], drafts()));
  const preparingCovers = createMemo(() => drafts().some((draft) => draft.coverStatus === "pending"));
  const preparingTitles = createMemo(() => drafts().some((draft) => draft.titleExtracting));
  const canSubmit = createMemo(
    () =>
      drafts().some((draft) => draft.uploadStatus !== "done") &&
      !uploading() &&
      !preparingCovers() &&
      !preparingTitles(),
  );

  const updateDraft = (id: string, updater: (draft: BookDraft) => BookDraft) => {
    setDrafts((currentDrafts) => currentDrafts.map((draft) => (draft.id === id ? updater(draft) : draft)));
  };

  const setCover = (id: string, file: File | undefined, status: CoverStatus, coverError?: string) => {
    updateDraft(id, (draft) => {
      revokePreviewUrl(draft);

      return {
        ...draft,
        coverFile: file,
        coverPreviewUrl: file ? URL.createObjectURL(file) : undefined,
        coverSource: file ? "manual" : undefined,
        coverStatus: status,
        coverError,
        uploadStatus: draft.uploadStatus === "done" ? "idle" : draft.uploadStatus,
        uploadError: undefined,
      };
    });
  };

  const prepareDraft = async (draft: BookDraft) => {
    try {
      const { prepareBookFile } = await loadCoverExtraction();
      const prepared = await prepareBookFile(draft.file);
      updateDraft(draft.id, (currentDraft) => {
        if (currentDraft.coverSource === "manual") {
          return currentDraft;
        }

        revokePreviewUrl(currentDraft);

        return {
          ...currentDraft,
          coverFile: prepared.coverFile,
          coverPreviewUrl: prepared.coverFile ? URL.createObjectURL(prepared.coverFile) : undefined,
          coverSource: prepared.coverFile ? "auto" : undefined,
          coverStatus: prepared.coverFile ? "ready" : "missing",
          coverError: undefined,
        };
      });
    } catch (nextError) {
      updateDraft(draft.id, (currentDraft) => ({
        ...currentDraft,
        coverStatus: currentDraft.coverSource === "manual" ? currentDraft.coverStatus : "failed",
        coverError:
          currentDraft.coverSource === "manual"
            ? currentDraft.coverError
            : errorMessage(nextError, t("coverCouldNotBeExtracted")),
      }));
    }
  };

  const addFiles = (fileList: FileList | File[]) => {
    const selectedFiles = Array.from(fileList).filter(isSupportedBookFile);

    if (!selectedFiles.length) {
      setError(t("selectBookFile"));
      return;
    }

    const nextDrafts = selectedFiles.map((file) => ({
      id: createDraftId(),
      file,
      title: titleFromFile(file),
      tags: [],
      coverStatus: "pending" as const,
      titleExtracting: false,
      uploadStatus: "idle" as const,
    }));

    if (!nextDrafts.length) {
      return;
    }

    setDrafts((currentDrafts) => [...currentDrafts, ...nextDrafts]);
    setError("");
    for (const draft of nextDrafts) {
      void prepareDraft(draft);
    }
  };

  const handleExtractTitle = async (id: string) => {
    const draft = drafts().find((currentDraft) => currentDraft.id === id);
    if (!draft) {
      return;
    }

    updateDraft(id, (currentDraft) => ({
      ...currentDraft,
      titleExtracting: true,
      titleError: undefined,
    }));

    try {
      const { extractBookTitle } = await loadCoverExtraction();
      const extractedTitle = (await extractBookTitle(draft.file)).trim();
      updateDraft(id, (currentDraft) => ({
        ...currentDraft,
        title: extractedTitle || currentDraft.title,
        titleExtracting: false,
        titleError: extractedTitle ? undefined : t("titleCouldNotBeExtracted"),
        uploadStatus: currentDraft.uploadStatus === "done" ? "idle" : currentDraft.uploadStatus,
        uploadError: undefined,
      }));
    } catch (nextError) {
      updateDraft(id, (currentDraft) => ({
        ...currentDraft,
        titleExtracting: false,
        titleError: errorMessage(nextError, t("titleCouldNotBeExtracted")),
      }));
    }
  };

  const removeDraft = (id: string) => {
    coverInputByDraftId.delete(id);
    const draft = drafts().find((currentDraft) => currentDraft.id === id);
    if (draft) {
      revokePreviewUrl(draft);
    }

    const nextDrafts = drafts().filter((currentDraft) => currentDraft.id !== id);
    setDrafts(nextDrafts);
    if (nextDrafts.length === 0) {
      setError("");
    }
  };

  const removeUploadedDrafts = () => {
    setDrafts((currentDrafts) => {
      const remainingDrafts: BookDraft[] = [];

      for (const draft of currentDrafts) {
        if (draft.uploadStatus === "done") {
          coverInputByDraftId.delete(draft.id);
          revokePreviewUrl(draft);
        } else {
          remainingDrafts.push(draft);
        }
      }

      return remainingDrafts;
    });
  };

  const handleCoverChange = async (id: string, file: File | undefined) => {
    if (!file) {
      return;
    }

    setCover(id, file, "pending");

    const draft = drafts().find((currentDraft) => currentDraft.id === id);
    const bookFileName = draft?.file.name ?? file.name;

    try {
      const { prepareCoverFile } = await loadCoverExtraction();
      const preparedCover = await prepareCoverFile(file, bookFileName);
      updateDraft(id, (currentDraft) => {
        if (currentDraft.coverFile !== file) {
          return currentDraft;
        }

        revokePreviewUrl(currentDraft);

        return {
          ...currentDraft,
          coverFile: preparedCover,
          coverPreviewUrl: URL.createObjectURL(preparedCover),
          coverSource: "manual",
          coverStatus: "ready",
          coverError: undefined,
        };
      });
    } catch (nextError) {
      updateDraft(id, (currentDraft) => {
        if (currentDraft.coverFile !== file) {
          return currentDraft;
        }

        revokePreviewUrl(currentDraft);

        return {
          ...currentDraft,
          coverFile: undefined,
          coverPreviewUrl: undefined,
          coverSource: undefined,
          coverStatus: "failed",
          coverError: errorMessage(nextError, t("coverCouldNotBeExtracted")),
        };
      });
    }
  };

  const uploadDraft = async (draft: BookDraft) => {
    updateDraft(draft.id, (currentDraft) => ({
      ...currentDraft,
      uploadStatus: "uploading",
      uploadError: undefined,
    }));

    let uploadedBookId = draft.uploadedBookId;

    try {
      if (!uploadedBookId) {
        const book = await uploadBook({
          file: draft.file,
          title: draft.title.trim(),
          tags: draft.tags,
          favorite: false,
        });
        uploadedBookId = book.id;
      }

      if (draft.coverFile) {
        await uploadBookCover(uploadedBookId, draft.coverFile);
      }

      updateDraft(draft.id, (currentDraft) => ({
        ...currentDraft,
        uploadedBookId,
        uploadStatus: "done",
        uploadError: undefined,
      }));
      return true;
    } catch (nextError) {
      updateDraft(draft.id, (currentDraft) => ({
        ...currentDraft,
        uploadedBookId,
        uploadStatus: "failed",
        uploadError: errorMessage(nextError, t("requestFailedTryAgain")),
      }));
      return false;
    }
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();

    if (drafts().length === 0) {
      setError(t("selectBookFile"));
      return;
    }

    setUploading(true);
    setError("");

    const uploadableDrafts = drafts().filter((draft) => draft.uploadStatus !== "done");
    const results: boolean[] = [];
    for (const draft of uploadableDrafts) {
      results.push(await uploadDraft(draft));
    }

    setUploading(false);
    await queryClient.invalidateQueries({ queryKey: booksQueryKey });

    if (results.every(Boolean)) {
      navigate("/library");
      return;
    }

    removeUploadedDrafts();
    setError(t("someBooksNotUploaded"));
  };

  onCleanup(() => {
    for (const draft of drafts()) {
      revokePreviewUrl(draft);
    }

    coverInputByDraftId.clear();
  });

  return (
    <AppLayout>
      <section class={styles.uploadPage}>
        <header class={styles.header}>
          <div>
            <p class={styles.kicker}>{t("upload")}</p>
            <h1>{t("addBooks")}</h1>
          </div>
        </header>

        <form class={styles.form} onSubmit={handleSubmit}>
          <button
            type="button"
            class={styles.dropzone}
            classList={{ [styles.dragActive]: dragActive() }}
            disabled={uploading()}
            onClick={() => fileInputEl?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addFiles(event.dataTransfer?.files ?? []);
            }}
          >
            <FileUp />
            <span>{selectedBooksText()}</span>
            <small>{t("supportedBookFormats")}</small>
          </button>

          <input
            ref={fileInputEl}
            class={styles.fileInput}
            type="file"
            accept=".pdf,.fb2"
            multiple
            onChange={(event) => {
              addFiles(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
            }}
          />

          <Show when={drafts().length > 0}>
            <div class={styles.bookDrafts}>
              <Index each={drafts()}>
                {(draft) => (
                  <article class={styles.bookDraft}>
                    <div class={styles.coverColumn}>
                      <button
                        type="button"
                        class={styles.coverButton}
                        aria-label={t("uploadCover")}
                        disabled={uploading()}
                        onClick={() => coverInputByDraftId.get(draft().id)?.click()}
                      >
                        <span class={styles.coverPreview}>
                          <Show
                            when={draft().coverPreviewUrl}
                            fallback={
                              <span class={styles.coverPlaceholder}>
                                <ImagePlus />
                              </span>
                            }
                          >
                            <img src={draft().coverPreviewUrl} alt="" />
                          </Show>
                        </span>
                      </button>

                      <input
                        ref={(element) => coverInputByDraftId.set(draft().id, element)}
                        class={styles.fileInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={uploading()}
                        onChange={(event) => {
                          void handleCoverChange(draft().id, event.currentTarget.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>

                    <div class={styles.draftFields}>
                      <InputContainer label={t("title")}>
                        <div class={styles.titleInput}>
                          <TextInput
                            class={styles.titleInputField}
                            value={draft().title}
                            disabled={uploading()}
                            onInput={(event) =>
                              updateDraft(draft().id, (currentDraft) => ({
                                ...currentDraft,
                                title: event.currentTarget.value,
                                titleError: undefined,
                                uploadStatus: currentDraft.uploadStatus === "done" ? "idle" : currentDraft.uploadStatus,
                                uploadError: undefined,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            class={styles.extractTitleButton}
                            iconOnly
                            iconStart={<ScanText />}
                            aria-label={t("extractTitle")}
                            title={t("extractTitle")}
                            disabled={uploading()}
                            loading={draft().titleExtracting}
                            onClick={() => void handleExtractTitle(draft().id)}
                          />
                        </div>
                      </InputContainer>

                      <label class={styles.fieldLabel}>
                        <span>{t("tags")}</span>
                        <TagsSelect
                          value={draft().tags}
                          options={tagOptions()}
                          onChange={(tags) =>
                            updateDraft(draft().id, (currentDraft) => ({
                              ...currentDraft,
                              tags,
                              uploadStatus: currentDraft.uploadStatus === "done" ? "idle" : currentDraft.uploadStatus,
                              uploadError: undefined,
                            }))
                          }
                          disabled={uploading()}
                        />
                      </label>

                      <div class={styles.draftStatus}>
                        <Show when={draft().coverStatus === "pending"}>
                          <p class={styles.statusText}>{t("extractingCover")}</p>
                        </Show>
                        <Show when={draft().coverStatus === "missing"}>
                          <p class={styles.statusText}>{t("coverNotFound")}</p>
                        </Show>
                        <Show when={draft().coverStatus === "failed"}>
                          <p class={styles.warningText}>{draft().coverError}</p>
                        </Show>
                        <Show when={draft().titleError}>
                          <p class={styles.warningText}>{draft().titleError}</p>
                        </Show>
                        <Show when={draft().uploadStatus === "done"}>
                          <p class={styles.successText}>{t("bookUploaded")}</p>
                        </Show>
                        <Show when={draft().uploadStatus === "failed"}>
                          <p class={styles.warningText}>{draft().uploadError}</p>
                        </Show>
                      </div>

                      <footer class={styles.draftActions}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={uploading()}
                          iconStart={<Trash2 />}
                          onClick={() => removeDraft(draft().id)}
                        >
                          {t("remove")}
                        </Button>
                      </footer>
                    </div>
                  </article>
                )}
              </Index>
            </div>
          </Show>

          <Show when={error()}>
            <p class={styles.error}>{error()}</p>
          </Show>

          <footer class={styles.actions}>
            <Button type="submit" loading={uploading()} disabled={!canSubmit()} iconStart={<Upload />}>
              {t("uploadBooks")}
            </Button>
          </footer>
        </form>
      </section>
    </AppLayout>
  );
}

export default UploadPage;
