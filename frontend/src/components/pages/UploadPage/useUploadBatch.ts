import { useNavigate } from '@solidjs/router';
import { useQueryClient } from '@tanstack/solid-query';
import { uploadBook, uploadBookCover, bookTagsQueryKey, booksQueryKey } from '@/api/books';
import { currentUserQueryKey } from '@/api/user';
import usePageLocker from '@/components/common/PageLockerProvider/usePageLocker';
import {
  isDjvuBookFile,
  isEpubBookFile,
  markDraftUploadFailed,
  markDraftUploading,
  type BookDraft,
} from './uploadDraftModel';

export default function useUploadBatch(options: {
  drafts: () => BookDraft[];
  updateDraft: (id: string, updater: (draft: BookDraft) => BookDraft) => void;
  removeDraft: (id: string) => void;
  setUploading: (uploading: boolean) => void;
  setUploadProgress: (
    progress:
      | { completed: number; total: number }
      | undefined
      | ((
          progress: { completed: number; total: number } | undefined,
        ) => { completed: number; total: number } | undefined),
  ) => void;
  setError: (error: string) => void;
  isPageActive: () => boolean;
  setBatchInProgress: (value: boolean) => void;
  incrementPreparationGeneration: () => void;
  cancelAllDraftPreparations: () => void;
  finalizePreparationForUpload: () => void;
  errorMessage: (error: unknown, fallback: string) => string;
  messages: {
    selectBookFile: () => string;
    validatingEpub: () => string;
    invalidEpub: () => string;
    validatingDjvu: () => string;
    invalidDjvu: () => string;
    requestFailedTryAgain: () => string;
  };
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { lockPage, unlockPage } = usePageLocker();

  const uploadDraft = async (draft: BookDraft) => {
    options.updateDraft(draft.id, markDraftUploading);

    try {
      const book = await uploadBook({
        file: draft.file,
        title: draft.title.trim(),
        description: draft.description,
        tags: draft.tags,
        favorite: false,
      });

      if (draft.coverFile) {
        await uploadBookCover(book.id, draft.coverFile).catch(() => undefined);
      }

      options.removeDraft(draft.id);
      return true;
    } catch (nextError) {
      options.updateDraft(draft.id, (currentDraft) =>
        markDraftUploadFailed(
          currentDraft,
          options.errorMessage(nextError, options.messages.requestFailedTryAgain()),
        ),
      );
      return false;
    }
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();

    if (options.drafts().length === 0) {
      options.setError(options.messages.selectBookFile());
      return;
    }

    const epubDrafts = options.drafts().filter((draft) => isEpubBookFile(draft.file));
    const djvuDrafts = options.drafts().filter((draft) => isDjvuBookFile(draft.file));
    if (epubDrafts.some((draft) => draft.epubValidationStatus === 'pending')) {
      options.setError(options.messages.validatingEpub());
      return;
    }

    if (epubDrafts.some((draft) => draft.epubValidationStatus === 'failed')) {
      options.setError(options.messages.invalidEpub());
      return;
    }

    if (djvuDrafts.some((draft) => draft.djvuValidationStatus === 'pending')) {
      options.setError(options.messages.validatingDjvu());
      return;
    }

    if (djvuDrafts.some((draft) => draft.djvuValidationStatus === 'failed')) {
      options.setError(options.messages.invalidDjvu());
      return;
    }

    const totalDrafts = options.drafts().length;
    options.setUploading(true);
    options.setUploadProgress(totalDrafts > 1 ? { completed: 0, total: totalDrafts } : undefined);
    options.setError('');
    lockPage();
    options.setBatchInProgress(true);
    options.incrementPreparationGeneration();
    options.cancelAllDraftPreparations();
    options.finalizePreparationForUpload();

    try {
      const uploadableDrafts = options.drafts();
      const results: boolean[] = [];
      for (const draft of uploadableDrafts) {
        const isUploaded = await uploadDraft(draft);
        results.push(isUploaded);
        if (isUploaded && options.isPageActive()) {
          options.setUploadProgress((progress) =>
            progress ? { ...progress, completed: progress.completed + 1 } : progress,
          );
        }
      }

      if (!options.isPageActive()) {
        return;
      }

      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      await queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });

      if (options.isPageActive() && results.every(Boolean)) {
        navigate('/library');
      }
    } finally {
      options.setBatchInProgress(false);
      if (options.isPageActive()) {
        options.setUploading(false);
        options.setUploadProgress(undefined);
      }
      unlockPage();
    }
  };

  return { handleSubmit };
}
