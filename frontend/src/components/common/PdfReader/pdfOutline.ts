import { PdfActionType, PdfZoomMode } from '@embedpdf/models';
import type { PdfBookmarkObject, PdfDestinationObject } from '@embedpdf/models';

export type PdfOutlineEntry = {
  label: string;
  destination?: PdfDestinationObject;
  children?: PdfOutlineEntry[];
};

export type PdfDestination = {
  pageNumber: number;
  offsetRatio: number;
};

function bookmarkDestination(bookmark: PdfBookmarkObject) {
  const target = bookmark.target;

  if (!target) {
    return undefined;
  }

  if (target.type === 'destination') {
    return target.destination;
  }

  if (target.action.type === PdfActionType.Goto) {
    return target.action.destination;
  }

  return undefined;
}

export function mapPdfOutline(items: PdfBookmarkObject[] | null | undefined): PdfOutlineEntry[] {
  if (!items?.length) {
    return [];
  }

  return items.map((item) => ({
    label: item.title,
    destination: bookmarkDestination(item),
    children: item.children?.length ? mapPdfOutline(item.children) : undefined,
  }));
}

export function resolvePdfDestination(
  destination: PdfDestinationObject | undefined,
  pageHeight: number | undefined,
): PdfDestination | undefined {
  if (!destination || destination.pageIndex < 0) {
    return undefined;
  }

  const offsetRatio =
    destination.zoom.mode === PdfZoomMode.XYZ && pageHeight && pageHeight > 0
      ? Math.max(0, Math.min(1, 1 - destination.zoom.params.y / pageHeight))
      : 0;

  return { pageNumber: destination.pageIndex + 1, offsetRatio };
}
