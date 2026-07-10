import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfOutlineEntry = {
  label: string;
  dest: string | Array<unknown> | null;
  children?: PdfOutlineEntry[];
};

type PdfJsOutlineItem = {
  title: string;
  dest: string | Array<unknown> | null;
  items?: PdfJsOutlineItem[];
};

export function mapPdfOutline(items: PdfJsOutlineItem[] | null | undefined): PdfOutlineEntry[] {
  if (!items?.length) {
    return [];
  }

  return items.map((item) => ({
    label: item.title,
    dest: item.dest,
    children: item.items?.length ? mapPdfOutline(item.items) : undefined,
  }));
}

export async function scrollToPdfDestination(
  document: PDFDocumentProxy,
  dest: string | Array<unknown> | null,
  pageRefs: Map<number, HTMLElement>,
  documentRef: HTMLElement | undefined,
  pageWidthPx: number,
) {
  if (!documentRef || !dest) {
    return;
  }

  const destination = Array.isArray(dest) ? dest : await document.getDestination(dest);

  if (!destination) {
    return;
  }

  const [pageRef, ...args] = destination;

  if (!pageRef || typeof pageRef !== 'object') {
    return;
  }

  const pageIndex = await document.getPageIndex(pageRef as { num: number; gen: number });
  const pageNumber = pageIndex + 1;
  const pageElement = pageRefs.get(pageNumber);

  if (!pageElement) {
    return;
  }

  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const displayScale = pageWidthPx / viewport.width;
  const displayHeight = viewport.height * displayScale;
  let offsetTop = 0;
  const kind = args[0];

  if (kind === 'XYZ' && typeof args[2] === 'number') {
    offsetTop = (viewport.height - args[2]) * displayScale;
  } else if (kind === 'FitH' && typeof args[1] === 'number') {
    offsetTop = (viewport.height - args[1]) * displayScale;
  } else if (kind === 'FitBH' && typeof args[1] === 'number') {
    offsetTop = (viewport.height - args[1]) * displayScale;
  }

  offsetTop = Math.max(0, Math.min(offsetTop, Math.max(0, displayHeight - 1)));

  const pageTop = pageElement.getBoundingClientRect().top + window.scrollY;

  window.scrollTo({ top: pageTop + offsetTop, behavior: 'instant' });
}
