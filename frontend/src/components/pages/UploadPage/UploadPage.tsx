import { createMemo, createSignal, Index, onCleanup, Show } from 'solid-js';
import { FileUp, ImagePlus, ScanText, Trash2, Upload } from 'lucide-solid';
import { createBookTagsQuery } from '@/api/books';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import usePageLocker from '@/components/common/PageLockerProvider/usePageLocker';
import TagsSelect from '@/components/common/TagsSelect/TagsSelect';
import TextInput from '@/components/common/TextInput/TextInput';
import AppLayout from '@/components/layouts/AppLayout/AppLayout';
import { useI18n } from '@/i18n/I18nProvider';
import {
  applyBulkTags as applyBulkTagsToDrafts,
  createBookDraft,
  finalizeDraftPreparation,
  isSupportedBookFile,
  removeDraft as removeDraftFromList,
  uniqueTags,
  updateDraft as updateDrafts,
  type BookDraft,
  type CoverStatus,
} from './uploadDraftModel';
import useUploadDraftPreparation from './useUploadDraftPreparation';
import useUploadBatch from './useUploadBatch';
import styles from './UploadPage.module.scss';

function createDraftId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
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
  const { unlockPage } = usePageLocker();
  const [drafts, setDrafts] = createSignal<BookDraft[]>([]);
  const [dragActive, setDragActive] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [bulkTags, setBulkTags] = createSignal<string[]>([]);
  const [uploadProgress, setUploadProgress] = createSignal<{ completed: number; total: number }>();
  const [error, setError] = createSignal('');
  let fileInputEl: HTMLInputElement | undefined;
  const coverInputByDraftId = new Map<string, HTMLInputElement>();
  const activeDraftIds = new Set<string>();
  let isPageActive = true;
  let batchInProgress = false;
  let preparationGeneration = 0;
  const bookTagsQuery = createBookTagsQuery();

  const selectedBooksText = createMemo(() => {
    const count = drafts().length;
    return count > 0 ? t('booksSelected').replace('{count}', String(count)) : t('fileNotSelected');
  });
  const tagOptions = createMemo(() => uniqueTags(bookTagsQuery.data?.items ?? [], drafts()));
  const canSubmit = createMemo(() => drafts().length > 0 && !uploading());
  const hasMultipleDrafts = createMemo(() => drafts().length > 1);

  const updateDraft = (id: string, updater: (draft: BookDraft) => BookDraft) => {
    if (!isPageActive || !activeDraftIds.has(id)) {
      return;
    }

    setDrafts((currentDrafts) => updateDrafts(currentDrafts, id, updater));
  };

  const updatePreparedDraft = (
    id: string,
    generation: number,
    updater: (draft: BookDraft) => BookDraft,
  ) => {
    if (
      !isPageActive ||
      batchInProgress ||
      generation !== preparationGeneration ||
      !activeDraftIds.has(id)
    ) {
      return;
    }

    updateDraft(id, updater);
  };

  const setCover = (
    id: string,
    file: File | undefined,
    status: CoverStatus,
    coverError?: string,
  ) => {
    updateDraft(id, (draft) => {
      revokePreviewUrl(draft);

      return {
        ...draft,
        coverFile: file,
        coverPreviewUrl: file ? URL.createObjectURL(file) : undefined,
        coverSource: file ? 'manual' : undefined,
        coverStatus: status,
        coverError,
        uploadError: undefined,
      };
    });
  };

  const draftPreparation = useUploadDraftPreparation({
    findDraft: (id) => drafts().find((draft) => draft.id === id),
    updateDraft,
    updatePreparedDraft,
    setCover,
    errorMessage,
    messages: {
      invalidEpub: () => t('invalidEpub'),
      coverCouldNotBeExtracted: () => t('coverCouldNotBeExtracted'),
      titleCouldNotBeExtracted: () => t('titleCouldNotBeExtracted'),
    },
  });

  const addFiles = (fileList: FileList | File[]) => {
    const selectedFiles = Array.from(fileList).filter(isSupportedBookFile);

    if (!selectedFiles.length) {
      setError(t('selectBookFile'));
      return;
    }

    const nextDrafts = selectedFiles.map((file) => createBookDraft(file, createDraftId()));

    if (!nextDrafts.length) {
      return;
    }

    for (const draft of nextDrafts) {
      activeDraftIds.add(draft.id);
    }
    setDrafts((currentDrafts) => [...currentDrafts, ...nextDrafts]);
    setError('');
    for (const draft of nextDrafts) {
      void draftPreparation.prepareDraft(draft, preparationGeneration);
    }
  };

  const removeDraft = (id: string) => {
    if (!isPageActive || !activeDraftIds.has(id)) {
      return;
    }

    coverInputByDraftId.delete(id);
    draftPreparation.cancelDraftPreparation(id);
    activeDraftIds.delete(id);
    const draft = drafts().find((currentDraft) => currentDraft.id === id);
    if (draft) {
      revokePreviewUrl(draft);
    }

    const nextDrafts = removeDraftFromList(drafts(), id);
    setDrafts(nextDrafts);
    if (nextDrafts.length === 0) {
      setError('');
    }
  };

  const finalizePreparationForUpload = () => {
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) => {
        if (draft.coverStatus === 'pending') {
          revokePreviewUrl(draft);
        }
        return finalizeDraftPreparation(draft);
      }),
    );
  };

  const applyBulkTags = () => {
    const tags = bulkTags();
    if (!tags.length) {
      return;
    }

    setDrafts((currentDrafts) => applyBulkTagsToDrafts(currentDrafts, tags));
  };

  const uploadBatch = useUploadBatch({
    drafts,
    updateDraft,
    removeDraft,
    setUploading,
    setUploadProgress,
    setError,
    isPageActive: () => isPageActive,
    setBatchInProgress: (value) => {
      batchInProgress = value;
    },
    incrementPreparationGeneration: () => {
      preparationGeneration += 1;
    },
    cancelAllDraftPreparations: draftPreparation.cancelAllDraftPreparations,
    finalizePreparationForUpload,
    errorMessage,
    messages: {
      selectBookFile: () => t('selectBookFile'),
      validatingEpub: () => t('validatingEpub'),
      invalidEpub: () => t('invalidEpub'),
      validatingDjvu: () => t('validatingDjvu'),
      invalidDjvu: () => t('invalidDjvu'),
      requestFailedTryAgain: () => t('requestFailedTryAgain'),
    },
  });

  onCleanup(() => {
    isPageActive = false;
    preparationGeneration += 1;
    draftPreparation.cancelAllDraftPreparations();
    unlockPage();

    for (const draft of drafts()) {
      revokePreviewUrl(draft);
    }

    coverInputByDraftId.clear();
    activeDraftIds.clear();
  });

  return (
    <AppLayout>
      <section class={styles.uploadPage}>
        <header class={styles.header}>
          <div>
            <p class={styles.kicker}>{t('upload')}</p>
            <h1>{t('addBooks')}</h1>
          </div>
        </header>

        <form class={styles.form} onSubmit={uploadBatch.handleSubmit}>
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
            <small>{t('supportedBookFormats')}</small>
          </button>

          <input
            ref={fileInputEl}
            class={styles.fileInput}
            type="file"
            accept=".djvu,.djv,.epub,.pdf,.fb2"
            multiple
            onChange={(event) => {
              addFiles(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
            }}
          />

          <Show when={drafts().length > 0}>
            <Show when={hasMultipleDrafts()}>
              <section class={styles.bulkTags}>
                <InputContainer label={t('tagsForAll')}>
                  <TagsSelect
                    value={bulkTags()}
                    options={tagOptions()}
                    onChange={setBulkTags}
                    disabled={uploading()}
                  />
                </InputContainer>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading() || bulkTags().length === 0}
                  onClick={applyBulkTags}
                >
                  {t('applyTagsToAll')}
                </Button>
              </section>
            </Show>

            <div class={styles.bookDrafts}>
              <Index each={drafts()}>
                {(draft) => (
                  <article class={styles.bookDraft}>
                    <div class={styles.coverColumn}>
                      <button
                        type="button"
                        class={styles.coverButton}
                        aria-label={t('uploadCover')}
                        disabled={uploading() || draft().coverStatus === 'pending'}
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
                        disabled={uploading() || draft().coverStatus === 'pending'}
                        onChange={(event) => {
                          void draftPreparation.prepareManualCover(
                            draft().id,
                            event.currentTarget.files?.[0],
                            preparationGeneration,
                          );
                          event.currentTarget.value = '';
                        }}
                      />
                    </div>

                    <div class={styles.draftFields}>
                      <InputContainer label={t('title')}>
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
                            aria-label={t('extractTitle')}
                            title={t('extractTitle')}
                            disabled={uploading()}
                            loading={draft().titleExtracting}
                            onClick={() =>
                              void draftPreparation.extractTitle(draft().id, preparationGeneration)
                            }
                          />
                        </div>
                      </InputContainer>

                      <InputContainer label={t('tags')}>
                        <TagsSelect
                          value={draft().tags}
                          options={tagOptions()}
                          onChange={(tags) =>
                            updateDraft(draft().id, (currentDraft) => ({
                              ...currentDraft,
                              tags,
                              uploadError: undefined,
                            }))
                          }
                          disabled={uploading()}
                        />
                      </InputContainer>

                      <div class={styles.draftStatus}>
                        <Show when={draft().coverStatus === 'pending'}>
                          <p class={styles.statusText}>{t('extractingCover')}</p>
                        </Show>
                        <Show when={draft().coverStatus === 'missing'}>
                          <p class={styles.statusText}>{t('coverNotFound')}</p>
                        </Show>
                        <Show when={draft().coverStatus === 'failed'}>
                          <p class={styles.warningText}>{draft().coverError}</p>
                        </Show>
                        <Show when={draft().titleError}>
                          <p class={styles.warningText}>{draft().titleError}</p>
                        </Show>
                        <Show when={draft().uploadStatus === 'failed'}>
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
                          {t('remove')}
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
            <Show when={uploadProgress()}>
              {(progress) => (
                <div
                  class={styles.uploadProgress}
                  role="progressbar"
                  aria-label={t('uploadProgress')
                    .replace('{count}', String(progress().completed))
                    .replace('{total}', String(progress().total))}
                  aria-valuemin="0"
                  aria-valuemax={progress().total}
                  aria-valuenow={progress().completed}
                >
                  <div
                    class={styles.uploadProgressBar}
                    style={{ width: `${(progress().completed / progress().total) * 100}%` }}
                  />
                </div>
              )}
            </Show>
            <Button
              type="submit"
              loading={uploading()}
              disabled={!canSubmit()}
              iconStart={<Upload />}
            >
              {t('uploadBooks')}
            </Button>
          </footer>
        </form>
      </section>
    </AppLayout>
  );
}

export default UploadPage;
