import type {
  ReflowableBinary,
  ReflowableDocument,
} from '@/components/common/ReflowableReader/reflowableTypes';

/** A spine item retained for diagnostics and future document-level navigation. */
export type EpubSpineItem = {
  id: string;
  path: string;
  linear: boolean;
};

/**
 * EPUB in the same shape consumed by the reflowable FB2 reader.
 * Resource ids in `binaries` are opaque and are only used by parsed blocks.
 */
export type EpubDocument = ReflowableDocument & {
  spine: EpubSpineItem[];
  coverImageId?: string;
  coverBinary?: ReflowableBinary;
};

export type EpubMetadata = Pick<EpubDocument, 'title' | 'authors' | 'coverImageId' | 'coverBinary'>;

export type EpubParseOptions = {
  signal?: AbortSignal;
};

export type EpubValidation = {
  entryCount: number;
  uncompressedSize: number;
};
