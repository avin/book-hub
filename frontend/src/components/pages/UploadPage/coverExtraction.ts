import type { PdfDocumentObject } from '@embedpdf/models';
import { getPdfiumEngine } from '@/api/pdfiumEngine';
import { parseFb2 } from '@/components/common/Fb2Reader/fb2Parser';
import { readFb2BlobText } from '@/bookFormats/fb2TextDecoder';
import type { ReflowableBinary } from '@/components/common/ReflowableReader/reflowableTypes';
import { extractEpubMetadata } from '@/components/common/EpubReader/epubParser';
import { createDjVuWorker, type DjVuWorker } from '@/api/djvujs';

const MAX_COVER_WIDTH = 900;
const MAX_COVER_HEIGHT = 1400;
const MAX_COVER_SIZE_BYTES = 700 * 1024;
const COVER_QUALITY = 0.86;

const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PreparedBookFile = {
  coverFile?: File;
};

export type BookPreparationOptions = {
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function bookTitle(authors: string[], title: string | undefined) {
  const normalizedTitle = title?.trim();
  const normalizedAuthors = authors.map((author) => author.trim()).filter(Boolean);

  if (normalizedAuthors.length && normalizedTitle) {
    return `${normalizedAuthors.join(', ')} - ${normalizedTitle}`;
  }

  return normalizedTitle || normalizedAuthors.join(', ');
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '');
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isFb2(file: File) {
  return file.name.toLowerCase().endsWith('.fb2');
}

function isEpub(file: File) {
  return file.name.toLowerCase().endsWith('.epub');
}

function isDjvu(file: File) {
  const fileName = file.name.toLowerCase();

  return fileName.endsWith('.djvu') || fileName.endsWith('.djv');
}

function normalizeImageType(contentType: string) {
  return contentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

function coverFileName(bookFileName: string, extension: string) {
  return `${baseName(bookFileName)}-cover.${extension}`;
}

function binaryToBlob(binary: ReflowableBinary) {
  const bytes = Uint8Array.from(atob(binary.data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: normalizeImageType(binary.contentType) });
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Cover image could not be decoded'));
    };
    image.src = url;
  });
}

function loadImageUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Cover image could not be decoded'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Cover image could not be compressed'));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function compressCover(blob: Blob, bookFileName: string) {
  if (!blob.type.startsWith('image/')) {
    return undefined;
  }

  const image = await loadImage(blob);
  const needsCompression =
    blob.size > MAX_COVER_SIZE_BYTES ||
    image.naturalWidth > MAX_COVER_WIDTH ||
    image.naturalHeight > MAX_COVER_HEIGHT ||
    !acceptedImageTypes.has(blob.type);

  if (!needsCompression) {
    const extension =
      blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], coverFileName(bookFileName, extension), { type: blob.type });
  }

  const scale = Math.min(
    1,
    MAX_COVER_WIDTH / image.naturalWidth,
    MAX_COVER_HEIGHT / image.naturalHeight,
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const compressedBlob = await canvasToBlob(canvas, 'image/jpeg', COVER_QUALITY);
  return new File([compressedBlob], coverFileName(bookFileName, 'jpg'), { type: 'image/jpeg' });
}

async function withPdfDocument<T>(
  file: File,
  signal: AbortSignal | undefined,
  run: (pdfDocument: PdfDocumentObject) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  const arrayBuffer = await abortable(file.arrayBuffer(), signal);
  throwIfAborted(signal);
  const engine = getPdfiumEngine();
  let pdfDocument: PdfDocumentObject | undefined;

  try {
    pdfDocument = await abortable(
      engine
        .openDocumentBuffer(
          { id: `book-cover-${crypto.randomUUID()}`, content: arrayBuffer },
          { normalizeRotation: true },
        )
        .toPromise(),
      signal,
    );
    throwIfAborted(signal);

    return await run(pdfDocument);
  } finally {
    if (pdfDocument) {
      await engine.closeDocument(pdfDocument).toPromise();
    }
  }
}

async function extractPdfCover(
  file: File,
  options?: BookPreparationOptions,
): Promise<PreparedBookFile> {
  const signal = options?.signal;

  return withPdfDocument(file, signal, async (pdfDocument) => {
    const page = pdfDocument.pages[0];
    if (!page) {
      throw new Error('PDF does not contain pages');
    }

    const scale = Math.min(
      2,
      MAX_COVER_WIDTH / page.size.width,
      MAX_COVER_HEIGHT / page.size.height,
    );
    const image = await abortable(
      getPdfiumEngine().renderPageRaw(pdfDocument, page, { scaleFactor: scale }).toPromise(),
      signal,
    );
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return {};
    }
    context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

    const coverBlob = await canvasToBlob(canvas, 'image/jpeg', COVER_QUALITY);
    return {
      coverFile: new File([coverBlob], coverFileName(file.name, 'jpg'), { type: 'image/jpeg' }),
    };
  });
}

async function extractFb2Cover(
  file: File,
  options?: BookPreparationOptions,
): Promise<PreparedBookFile> {
  throwIfAborted(options?.signal);
  const fb2Document = parseFb2(await abortable(readFb2BlobText(file), options?.signal));
  throwIfAborted(options?.signal);
  const coverImageId = fb2Document.blocks.find(
    (block) => block.kind === 'image' && block.role === 'metadata',
  )?.imageId;
  const coverBinary =
    (coverImageId ? fb2Document.binaries.get(coverImageId) : undefined) ??
    Array.from(fb2Document.binaries.values()).find((binary) =>
      normalizeImageType(binary.contentType).startsWith('image/'),
    );

  return {
    coverFile: coverBinary ? await compressCover(binaryToBlob(coverBinary), file.name) : undefined,
  };
}

async function extractEpubCover(
  file: File,
  options?: BookPreparationOptions,
): Promise<PreparedBookFile> {
  const metadata = await extractEpubMetadata(file, options);
  throwIfAborted(options?.signal);

  if (!metadata.coverBinary) {
    return {};
  }

  return {
    coverFile: await compressCover(binaryToBlob(metadata.coverBinary), file.name).catch(
      () => undefined,
    ),
  };
}

async function withDjvuWorker<T>(
  file: File,
  signal: AbortSignal | undefined,
  run: (worker: DjVuWorker) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  const worker = await abortable(createDjVuWorker(), signal);

  try {
    const buffer = await abortable(file.arrayBuffer(), signal);
    await abortable(worker.createDocument(buffer), signal);
    throwIfAborted(signal);

    if (!(await abortable(worker.doc.isBundled().run(), signal))) {
      throw new Error('Indirect DJVU is not supported');
    }

    const pageCount = await abortable(worker.doc.getPagesQuantity().run(), signal);

    if (pageCount < 1) {
      throw new Error('DJVU does not contain pages');
    }

    return await run(worker);
  } finally {
    worker.reset();
    worker.worker.terminate();
  }
}

async function extractDjvuCover(
  file: File,
  options?: BookPreparationOptions,
): Promise<PreparedBookFile> {
  return withDjvuWorker(file, options?.signal, async (worker) => {
    const pageImage = await abortable(
      worker.doc.getPage(1).createPngObjectUrl().run(),
      options?.signal,
    );

    try {
      const image = await abortable(loadImageUrl(pageImage.url), options?.signal);
      const scale = Math.min(
        1,
        MAX_COVER_WIDTH / image.naturalWidth,
        MAX_COVER_HEIGHT / image.naturalHeight,
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');

      if (!context) {
        return {};
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const coverBlob = await canvasToBlob(canvas, 'image/jpeg', COVER_QUALITY);

      return {
        coverFile: new File([coverBlob], coverFileName(file.name, 'jpg'), { type: 'image/jpeg' }),
      };
    } finally {
      worker.revokeObjectURL(pageImage.url);
    }
  });
}

export async function prepareBookFile(
  file: File,
  options?: BookPreparationOptions,
): Promise<PreparedBookFile> {
  if (isFb2(file)) {
    return extractFb2Cover(file, options);
  }

  if (isPdf(file)) {
    return extractPdfCover(file, options);
  }

  if (isEpub(file)) {
    return extractEpubCover(file, options);
  }

  if (isDjvu(file)) {
    return extractDjvuCover(file, options);
  }

  return {};
}

export async function prepareCoverFile(
  file: File,
  bookFileName: string,
  options?: BookPreparationOptions,
) {
  throwIfAborted(options?.signal);
  return (await compressCover(file, bookFileName)) ?? file;
}

export async function extractBookTitle(file: File, options?: BookPreparationOptions) {
  const signal = options?.signal;

  if (isFb2(file)) {
    throwIfAborted(signal);
    const fb2Document = parseFb2(await abortable(readFb2BlobText(file), signal));
    return bookTitle(fb2Document.authors, fb2Document.title);
  }

  if (isEpub(file)) {
    const metadata = await extractEpubMetadata(file, { signal });
    return bookTitle(metadata.authors, metadata.title);
  }

  if (isDjvu(file)) {
    return '';
  }

  if (!isPdf(file)) {
    return '';
  }

  return withPdfDocument(file, signal, async (pdfDocument) => {
    const metadata = await abortable(
      getPdfiumEngine().getMetadata(pdfDocument).toPromise(),
      signal,
    );
    const title = metadata.title ?? '';
    const author = metadata.author ?? '';

    return bookTitle(author ? [author] : [], title);
  });
}
