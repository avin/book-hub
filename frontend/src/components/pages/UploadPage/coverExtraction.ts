import * as pdfjs from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { parseFb2 } from "@/components/common/Fb2Reader/fb2Parser";
import type { Fb2Binary } from "@/components/common/Fb2Reader/fb2Types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const MAX_COVER_WIDTH = 900;
const MAX_COVER_HEIGHT = 1400;
const MAX_COVER_SIZE_BYTES = 700 * 1024;
const COVER_QUALITY = 0.86;

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedBookFile = {
  coverFile?: File;
};

function bookTitle(authors: string[], title: string | undefined) {
  const normalizedTitle = title?.trim();
  const normalizedAuthors = authors.map((author) => author.trim()).filter(Boolean);

  if (normalizedAuthors.length && normalizedTitle) {
    return `${normalizedAuthors.join(", ")} - ${normalizedTitle}`;
  }

  return normalizedTitle || normalizedAuthors.join(", ");
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isFb2(file: File) {
  return file.name.toLowerCase().endsWith(".fb2");
}

function normalizeImageType(contentType: string) {
  return contentType.split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

function coverFileName(bookFileName: string, extension: string) {
  return `${baseName(bookFileName)}-cover.${extension}`;
}

function binaryToBlob(binary: Fb2Binary) {
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
      reject(new Error("Cover image could not be decoded"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Cover image could not be compressed"));
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
  if (!blob.type.startsWith("image/")) {
    return undefined;
  }

  const image = await loadImage(blob);
  const needsCompression =
    blob.size > MAX_COVER_SIZE_BYTES ||
    image.naturalWidth > MAX_COVER_WIDTH ||
    image.naturalHeight > MAX_COVER_HEIGHT ||
    !acceptedImageTypes.has(blob.type);

  if (!needsCompression) {
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], coverFileName(bookFileName, extension), { type: blob.type });
  }

  const scale = Math.min(1, MAX_COVER_WIDTH / image.naturalWidth, MAX_COVER_HEIGHT / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const compressedBlob = await canvasToBlob(canvas, "image/jpeg", COVER_QUALITY);
  return new File([compressedBlob], coverFileName(bookFileName, "jpg"), { type: "image/jpeg" });
}

async function extractFb2Cover(file: File): Promise<PreparedBookFile> {
  const fb2Document = parseFb2(await file.text());
  const coverImageId = fb2Document.blocks.find((block) => block.kind === "image" && block.role === "metadata")
    ?.imageId;
  const coverBinary =
    (coverImageId ? fb2Document.binaries.get(coverImageId) : undefined) ??
    Array.from(fb2Document.binaries.values()).find((binary) =>
      normalizeImageType(binary.contentType).startsWith("image/"),
    );

  return {
    coverFile: coverBinary ? await compressCover(binaryToBlob(coverBinary), file.name) : undefined,
  };
}

async function extractPdfCover(file: File): Promise<PreparedBookFile> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdfDocument = await loadingTask.promise;

  try {
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_COVER_WIDTH / viewport.width, MAX_COVER_HEIGHT / viewport.height);
    const renderViewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(renderViewport.width));
    canvas.height = Math.max(1, Math.round(renderViewport.height));

    await page.render({ canvas, viewport: renderViewport }).promise;

    const coverBlob = await canvasToBlob(canvas, "image/jpeg", COVER_QUALITY);
    return {
      coverFile: new File([coverBlob], coverFileName(file.name, "jpg"), { type: "image/jpeg" }),
    };
  } finally {
    await pdfDocument.cleanup();
    await loadingTask.destroy();
  }
}

export async function prepareBookFile(file: File): Promise<PreparedBookFile> {
  if (isFb2(file)) {
    return extractFb2Cover(file);
  }

  if (isPdf(file)) {
    return extractPdfCover(file);
  }

  return {};
}

export async function prepareCoverFile(file: File, bookFileName: string) {
  return (await compressCover(file, bookFileName)) ?? file;
}

export async function extractBookTitle(file: File) {
  if (isFb2(file)) {
    const fb2Document = parseFb2(await file.text());
    return bookTitle(fb2Document.authors, fb2Document.title);
  }

  if (!isPdf(file)) {
    return "";
  }

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdfDocument = await loadingTask.promise;

  try {
    const metadata = await pdfDocument.getMetadata();
    const info = metadata.info as { Title?: unknown; Author?: unknown };
    const metadataTitle = metadata.metadata?.get("dc:title") ?? metadata.metadata?.get("Title");
    const metadataAuthor = metadata.metadata?.get("dc:creator") ?? metadata.metadata?.get("Author");
    const title = typeof metadataTitle === "string" ? metadataTitle : typeof info.Title === "string" ? info.Title : "";
    const author =
      typeof metadataAuthor === "string" ? metadataAuthor : typeof info.Author === "string" ? info.Author : "";

    return bookTitle(author ? [author] : [], title);
  } finally {
    await pdfDocument.cleanup();
    await loadingTask.destroy();
  }
}
