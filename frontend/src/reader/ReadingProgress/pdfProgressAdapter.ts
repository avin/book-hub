import type { ReadingProgressAdapter } from './types';

export type PdfProgressPage = {
  pageNumber: number;
  width: number;
  height: number;
};

export type PdfProgressAdapterState = {
  getPages: () => PdfProgressPage[];
  getPageWidth: () => number;
  getDocumentScrollTop: () => number;
  getViewportHeight: () => number;
  getPaddingTop: () => number;
  getGap: () => number;
  isReady: () => boolean;
  scrollToDocumentTop: (documentScrollTop: number) => void;
  onScroll?: (callback: () => void) => () => void;
};

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function pageHeightAtWidth(page: PdfProgressPage, widthPx: number) {
  return widthPx * (page.height / page.width);
}

export function documentHeightAtWidth(
  pages: PdfProgressPage[],
  widthPx: number,
  paddingTop: number,
  gap: number,
) {
  if (pages.length === 0) {
    return paddingTop;
  }

  let height = paddingTop;

  for (const page of pages) {
    height += pageHeightAtWidth(page, widthPx);

    if (page.pageNumber < pages[pages.length - 1].pageNumber) {
      height += gap;
    }
  }

  return height;
}

export function createPdfProgressAdapter(state: PdfProgressAdapterState): ReadingProgressAdapter {
  const maxDocumentScroll = () => {
    const pages = state.getPages();
    const totalHeight = documentHeightAtWidth(
      pages,
      state.getPageWidth(),
      state.getPaddingTop(),
      state.getGap(),
    );

    return Math.max(0, totalHeight - state.getViewportHeight());
  };

  return {
    isReady: () => state.isReady(),

    getProgress() {
      const maxScroll = maxDocumentScroll();

      if (maxScroll === 0) {
        return 0;
      }

      return clampPercent((state.getDocumentScrollTop() / maxScroll) * 100);
    },

    restoreProgress(percent: number) {
      const maxScroll = maxDocumentScroll();
      state.scrollToDocumentTop((maxScroll * clampPercent(percent)) / 100);
    },

    onProgressChange(callback) {
      return state.onScroll?.(callback) ?? (() => undefined);
    },
  };
}
