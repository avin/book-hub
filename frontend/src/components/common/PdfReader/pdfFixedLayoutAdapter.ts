import type {
  ImageDataLike,
  PdfBookmarkObject,
  PdfDocumentObject,
  PdfPageObject,
  PdfTextRectObject,
  SearchAllPagesResult,
} from '@embedpdf/models';
import { getPdfiumEngine } from '@/api/pdfiumEngine';
import { resolvePdfDestination, type PdfOutlineEntry } from './pdfOutline';
import type { FixedLayoutDocumentAdapter } from '../FixedLayoutReader/fixedLayoutReader';

export type PdfSearchQuery = {
  query: string;
};

export type PdfNavigationTarget = {
  destination: PdfOutlineEntry['destination'];
};

function documentId() {
  return `book-hub-${crypto.randomUUID()}`;
}

export function createPdfFixedLayoutAdapter(config: { fileUrl: () => string }) {
  const engine = getPdfiumEngine();
  const adapter: FixedLayoutDocumentAdapter<
    PdfDocumentObject,
    PdfBookmarkObject[],
    PdfPageObject,
    PdfSearchQuery,
    SearchAllPagesResult,
    PdfNavigationTarget,
    ReturnType<typeof resolvePdfDestination>
  > = {
    load() {
      return engine
        .openDocumentUrl(
          { id: documentId(), url: config.fileUrl() },
          {
            mode: 'range-request',
            normalizeRotation: true,
            requestOptions: { credentials: 'include' },
          },
        )
        .toPromise();
    },
    async getPages(document) {
      return document.pages.map((page) => ({
        pageNumber: page.index + 1,
        width: page.size.width,
        height: page.size.height,
      }));
    },
    async getOutline(document) {
      return (await engine.getBookmarks(document).toPromise()).bookmarks;
    },
    async renderPage(document, pageNumber) {
      const page = document.pages[pageNumber - 1];

      if (!page) {
        throw new Error(`PDF page ${pageNumber} does not exist`);
      }

      return page;
    },
    releasePage() {},
    search(document, query) {
      return engine.searchAllPages(document, query.query).toPromise();
    },
    async navigate(_document, target) {
      const page = target.destination ? _document.pages[target.destination.pageIndex] : undefined;
      return resolvePdfDestination(target.destination, page?.size.height);
    },
    async release(document) {
      await engine.closeDocument(document).toPromise();
    },
  };

  return {
    adapter,
    renderPage(
      document: PdfDocumentObject,
      page: PdfPageObject,
      scaleFactor: number,
    ): { task: ReturnType<typeof engine.renderPageRaw>; promise: Promise<ImageDataLike> } {
      const task = engine.renderPageRaw(document, page, {
        scaleFactor,
        withAnnotations: true,
        withForms: true,
      });

      return { task, promise: task.toPromise() };
    },
    getPageText(document: PdfDocumentObject, page: PdfPageObject): Promise<PdfTextRectObject[]> {
      return engine.getPageTextRects(document, page).toPromise();
    },
  };
}
