import type {
  Fb2Binary,
  Fb2Block,
  Fb2Note,
  Fb2OutlineEntry,
} from '@/components/common/Fb2Reader/fb2Types';

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
export type EpubDocument = {
  title: string;
  authors: string[];
  blocks: Fb2Block[];
  outline: Fb2OutlineEntry[];
  notes: Map<string, Fb2Note>;
  binaries: Map<string, Fb2Binary>;
  spine: EpubSpineItem[];
  coverImageId?: string;
  coverBinary?: Fb2Binary;
};

export type EpubMetadata = Pick<EpubDocument, 'title' | 'authors' | 'coverImageId' | 'coverBinary'>;

export type EpubParseOptions = {
  signal?: AbortSignal;
};

export type EpubValidation = {
  entryCount: number;
  uncompressedSize: number;
};
