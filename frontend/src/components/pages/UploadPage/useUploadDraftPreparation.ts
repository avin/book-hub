import { loadModule } from '@/loadModule';
import {
  isDjvuBookFile,
  isEpubBookFile,
  type BookDraft,
  type CoverStatus,
} from './uploadDraftModel';

type DraftUpdater = (draft: BookDraft) => BookDraft;

type Messages = {
  invalidEpub: () => string;
  coverCouldNotBeExtracted: () => string;
  titleCouldNotBeExtracted: () => string;
};

let coverExtractionModule: Promise<typeof import('./coverExtraction')> | undefined;

function loadCoverExtraction() {
  coverExtractionModule ??= loadModule(() => import('./coverExtraction'));

  return coverExtractionModule;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function useUploadDraftPreparation(options: {
  findDraft: (id: string) => BookDraft | undefined;
  updateDraft: (id: string, updater: DraftUpdater) => void;
  updatePreparedDraft: (id: string, generation: number, updater: DraftUpdater) => void;
  setCover: (id: string, file: File | undefined, status: CoverStatus, coverError?: string) => void;
  errorMessage: (error: unknown, fallback: string) => string;
  messages: Messages;
}) {
  const preparationAbortByDraftId = new Map<string, Map<string, AbortController>>();

  const beginDraftPreparation = (draftId: string, kind: string) => {
    const preparations = preparationAbortByDraftId.get(draftId) ?? new Map();
    preparations.get(kind)?.abort();
    const controller = new AbortController();
    preparations.set(kind, controller);
    preparationAbortByDraftId.set(draftId, preparations);
    return controller;
  };

  const finishDraftPreparation = (draftId: string, kind: string, controller: AbortController) => {
    const preparations = preparationAbortByDraftId.get(draftId);
    if (preparations?.get(kind) === controller) {
      preparations.delete(kind);
      if (preparations.size === 0) preparationAbortByDraftId.delete(draftId);
    }
  };

  const cancelDraftPreparation = (draftId: string) => {
    for (const controller of preparationAbortByDraftId.get(draftId)?.values() ?? []) {
      controller.abort();
    }
    preparationAbortByDraftId.delete(draftId);
  };

  const cancelAllDraftPreparations = () => {
    for (const preparations of preparationAbortByDraftId.values()) {
      for (const controller of preparations.values()) controller.abort();
    }
    preparationAbortByDraftId.clear();
  };

  const prepareDraft = async (draft: BookDraft, generation: number) => {
    const preparation = beginDraftPreparation(draft.id, 'book');

    try {
      const { prepareBookFile } = await loadCoverExtraction();
      const prepared = await prepareBookFile(draft.file, { signal: preparation.signal });
      options.updatePreparedDraft(draft.id, generation, (currentDraft) => {
        const manualCover = currentDraft.coverSource === 'manual';
        if (!manualCover && currentDraft.coverPreviewUrl) {
          URL.revokeObjectURL(currentDraft.coverPreviewUrl);
        }

        return {
          ...currentDraft,
          ...(manualCover
            ? {}
            : {
                coverFile: prepared.coverFile,
                coverPreviewUrl: prepared.coverFile
                  ? URL.createObjectURL(prepared.coverFile)
                  : undefined,
                coverSource: prepared.coverFile ? ('auto' as const) : undefined,
                coverStatus: prepared.coverFile ? ('ready' as const) : ('missing' as const),
                coverError: undefined,
              }),
          epubValidationStatus: isEpubBookFile(currentDraft.file)
            ? 'ready'
            : currentDraft.epubValidationStatus,
          djvuValidationStatus: isDjvuBookFile(currentDraft.file)
            ? 'ready'
            : currentDraft.djvuValidationStatus,
        };
      });
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return;
      }

      options.updatePreparedDraft(draft.id, generation, (currentDraft) => ({
        ...currentDraft,
        coverStatus: currentDraft.coverSource === 'manual' ? currentDraft.coverStatus : 'failed',
        epubValidationStatus: isEpubBookFile(currentDraft.file)
          ? 'failed'
          : currentDraft.epubValidationStatus,
        djvuValidationStatus: isDjvuBookFile(currentDraft.file)
          ? 'failed'
          : currentDraft.djvuValidationStatus,
        coverError:
          currentDraft.coverSource === 'manual'
            ? currentDraft.coverError
            : isEpubBookFile(currentDraft.file)
              ? options.messages.invalidEpub()
              : options.errorMessage(nextError, options.messages.coverCouldNotBeExtracted()),
      }));
    } finally {
      finishDraftPreparation(draft.id, 'book', preparation);
    }
  };

  const extractTitle = async (id: string, generation: number) => {
    const draft = options.findDraft(id);
    if (!draft) {
      return;
    }

    const preparation = beginDraftPreparation(id, 'title');
    options.updateDraft(id, (currentDraft) => ({
      ...currentDraft,
      titleExtracting: true,
      titleError: undefined,
    }));

    try {
      const { extractBookTitle } = await loadCoverExtraction();
      const extractedTitle = (
        await extractBookTitle(draft.file, { signal: preparation.signal })
      ).trim();
      options.updatePreparedDraft(id, generation, (currentDraft) => ({
        ...currentDraft,
        title: extractedTitle || currentDraft.title,
        titleExtracting: false,
        titleError: extractedTitle ? undefined : options.messages.titleCouldNotBeExtracted(),
        uploadError: undefined,
      }));
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return;
      }

      options.updatePreparedDraft(id, generation, (currentDraft) => ({
        ...currentDraft,
        titleExtracting: false,
        titleError: options.errorMessage(nextError, options.messages.titleCouldNotBeExtracted()),
      }));
    } finally {
      finishDraftPreparation(id, 'title', preparation);
    }
  };

  const prepareManualCover = async (id: string, file: File | undefined, generation: number) => {
    if (!file) {
      return;
    }

    const preparation = beginDraftPreparation(id, 'cover');
    options.setCover(id, file, 'pending');

    const draft = options.findDraft(id);
    const bookFileName = draft?.file.name ?? file.name;

    try {
      const { prepareCoverFile } = await loadCoverExtraction();
      const preparedCover = await prepareCoverFile(file, bookFileName, {
        signal: preparation.signal,
      });
      options.updatePreparedDraft(id, generation, (currentDraft) => {
        if (currentDraft.coverFile !== file) {
          return currentDraft;
        }

        if (currentDraft.coverPreviewUrl) {
          URL.revokeObjectURL(currentDraft.coverPreviewUrl);
        }

        return {
          ...currentDraft,
          coverFile: preparedCover,
          coverPreviewUrl: URL.createObjectURL(preparedCover),
          coverSource: 'manual',
          coverStatus: 'ready',
          coverError: undefined,
        };
      });
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return;
      }

      options.updatePreparedDraft(id, generation, (currentDraft) => {
        if (currentDraft.coverFile !== file) {
          return currentDraft;
        }

        if (currentDraft.coverPreviewUrl) {
          URL.revokeObjectURL(currentDraft.coverPreviewUrl);
        }

        return {
          ...currentDraft,
          coverFile: undefined,
          coverPreviewUrl: undefined,
          coverSource: undefined,
          coverStatus: 'failed',
          coverError: options.errorMessage(nextError, options.messages.coverCouldNotBeExtracted()),
        };
      });
    } finally {
      finishDraftPreparation(id, 'cover', preparation);
    }
  };

  return {
    cancelAllDraftPreparations,
    cancelDraftPreparation,
    extractTitle,
    prepareDraft,
    prepareManualCover,
  };
}
