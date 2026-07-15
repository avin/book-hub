export type CoverStatus = 'pending' | 'ready' | 'missing' | 'failed';
export type UploadStatus = 'idle' | 'uploading' | 'failed';
export type EpubValidationStatus = 'pending' | 'ready' | 'failed';
export type DjvuValidationStatus = 'pending' | 'ready' | 'failed';

export type BookDraft = {
  id: string;
  file: File;
  title: string;
  tags: string[];
  coverFile?: File;
  coverPreviewUrl?: string;
  coverSource?: 'auto' | 'manual';
  coverStatus: CoverStatus;
  epubValidationStatus: EpubValidationStatus;
  djvuValidationStatus: DjvuValidationStatus;
  coverError?: string;
  titleExtracting: boolean;
  titleError?: string;
  uploadStatus: UploadStatus;
  uploadError?: string;
};

export function titleFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, '');
}

export function isSupportedBookFile(file: File) {
  const fileName = file.name.toLowerCase();
  return (
    file.type === 'application/pdf' ||
    fileName.endsWith('.pdf') ||
    fileName.endsWith('.fb2') ||
    fileName.endsWith('.epub') ||
    fileName.endsWith('.djvu') ||
    fileName.endsWith('.djv')
  );
}

export function isEpubBookFile(file: File) {
  return file.name.toLowerCase().endsWith('.epub');
}

export function isDjvuBookFile(file: File) {
  const fileName = file.name.toLowerCase();

  return fileName.endsWith('.djvu') || fileName.endsWith('.djv');
}

export function createBookDraft(file: File, id: string): BookDraft {
  return {
    id,
    file,
    title: titleFromFile(file),
    tags: [],
    coverStatus: 'pending',
    epubValidationStatus: isEpubBookFile(file) ? 'pending' : 'ready',
    djvuValidationStatus: isDjvuBookFile(file) ? 'pending' : 'ready',
    titleExtracting: false,
    uploadStatus: 'idle',
  };
}

export function uniqueTags(existingTags: string[], drafts: BookDraft[]) {
  const tags = new Map<string, string>();

  for (const tag of existingTags) {
    tags.set(tag, tag);
  }
  for (const draft of drafts) {
    for (const tag of draft.tags) {
      tags.set(tag, tag);
    }
  }

  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

export function appendTags(existingTags: string[], tags: string[]) {
  const existingTagsSet = new Set(existingTags);

  return [...existingTags, ...tags.filter((tag) => !existingTagsSet.has(tag))];
}

export function updateDraft(
  drafts: BookDraft[],
  id: string,
  updater: (draft: BookDraft) => BookDraft,
) {
  return drafts.map((draft) => (draft.id === id ? updater(draft) : draft));
}

export function removeDraft(drafts: BookDraft[], id: string) {
  return drafts.filter((draft) => draft.id !== id);
}

export function applyBulkTags(drafts: BookDraft[], tags: string[]) {
  if (!tags.length) {
    return drafts;
  }

  return drafts.map((draft) => ({
    ...draft,
    tags: appendTags(draft.tags, tags),
    uploadError: undefined,
  }));
}

export function markDraftUploading(draft: BookDraft): BookDraft {
  return {
    ...draft,
    uploadStatus: 'uploading',
    uploadError: undefined,
  };
}

export function markDraftUploadFailed(draft: BookDraft, uploadError: string): BookDraft {
  return {
    ...draft,
    uploadStatus: 'failed',
    uploadError,
  };
}

export function finalizeDraftPreparation(draft: BookDraft): BookDraft {
  if (draft.coverStatus !== 'pending') {
    return draft.titleExtracting ? { ...draft, titleExtracting: false } : draft;
  }

  return {
    ...draft,
    coverFile: undefined,
    coverPreviewUrl: undefined,
    coverSource: undefined,
    coverStatus: 'missing',
    coverError: undefined,
    titleExtracting: false,
  };
}
