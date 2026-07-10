import { describe, expect, it } from 'vitest';
import {
  createPdfProgressAdapter,
  documentHeightAtWidth,
  type PdfProgressPage,
} from './pdfProgressAdapter';

const pages: PdfProgressPage[] = [
  { pageNumber: 1, width: 100, height: 200 },
  { pageNumber: 2, width: 100, height: 300 },
  { pageNumber: 3, width: 100, height: 100 },
];

describe('documentHeightAtWidth', () => {
  it('sums page heights with padding and gaps', () => {
    expect(documentHeightAtWidth(pages, 100, 32, 18)).toBe(32 + 200 + 18 + 300 + 18 + 100);
  });
});

describe('createPdfProgressAdapter', () => {
  it('returns 0 at the start and 100 at the end of the document', () => {
    let documentScrollTop = 0;
    const adapter = createPdfProgressAdapter({
      getPages: () => pages,
      getPageWidth: () => 100,
      getDocumentScrollTop: () => documentScrollTop,
      getViewportHeight: () => 200,
      getPaddingTop: () => 32,
      getGap: () => 18,
      isReady: () => true,
      scrollToDocumentTop: (nextTop) => {
        documentScrollTop = nextTop;
      },
    });

    expect(adapter.getProgress()).toBe(0);

    documentScrollTop = documentHeightAtWidth(pages, 100, 32, 18) - 200;
    expect(adapter.getProgress()).toBe(100);
  });

  it('round-trips restoreProgress through getProgress', () => {
    let documentScrollTop = 0;
    const adapter = createPdfProgressAdapter({
      getPages: () => pages,
      getPageWidth: () => 100,
      getDocumentScrollTop: () => documentScrollTop,
      getViewportHeight: () => 200,
      getPaddingTop: () => 32,
      getGap: () => 18,
      isReady: () => true,
      scrollToDocumentTop: (nextTop) => {
        documentScrollTop = nextTop;
      },
    });

    adapter.restoreProgress(40);
    expect(adapter.getProgress()).toBeCloseTo(40, 5);
  });

  it('increases monotonically when scrolling forward', () => {
    let documentScrollTop = 0;
    const adapter = createPdfProgressAdapter({
      getPages: () => pages,
      getPageWidth: () => 100,
      getDocumentScrollTop: () => documentScrollTop,
      getViewportHeight: () => 200,
      getPaddingTop: () => 32,
      getGap: () => 18,
      isReady: () => true,
      scrollToDocumentTop: (nextTop) => {
        documentScrollTop = nextTop;
      },
    });

    const maxScroll = documentHeightAtWidth(pages, 100, 32, 18) - 200;
    const samples = [0, maxScroll * 0.2, maxScroll * 0.5, maxScroll * 0.8, maxScroll].map((top) => {
      documentScrollTop = top;
      return adapter.getProgress();
    });

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]);
    }
  });
});
