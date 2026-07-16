import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { EventBus, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { pdfjsDocumentParams } from '@/api/pdfjsConfig';
import { resolvePdfDestination, type PdfOutlineEntry } from './pdfOutline';
import type {
  FixedLayoutDocumentAdapter,
  FixedLayoutPageDescriptor,
} from '../FixedLayoutReader/fixedLayoutReader';

export type PdfSearchQuery = {
  query: string;
  direction: 'next' | 'previous';
  isContinuation: boolean;
};

export type PdfNavigationTarget = {
  destination: PdfOutlineEntry['dest'];
  pageWidth: number;
};

export function createPdfFixedLayoutAdapter(config: {
  fileUrl: () => string;
  onLoadingTask: (task: PDFDocumentLoadingTask) => void;
  searchLinkService: { page: number; pagesCount: number };
}) {
  const pagesByDocument = new WeakMap<PDFDocumentProxy, Map<number, PDFPageProxy>>();
  const searchEventBus = new EventBus();
  const findController = new PDFFindController({
    linkService: config.searchLinkService as never,
    eventBus: searchEventBus,
    delay: 0,
  });
  const adapter: FixedLayoutDocumentAdapter<
    PDFDocumentProxy,
    Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
    PDFPageProxy,
    PdfSearchQuery,
    undefined,
    PdfNavigationTarget,
    Awaited<ReturnType<typeof resolvePdfDestination>>
  > = {
    load() {
      const task = pdfjs.getDocument({
        url: config.fileUrl(),
        withCredentials: true,
        ...pdfjsDocumentParams,
      });
      config.onLoadingTask(task);
      return task.promise;
    },
    async getPages(document) {
      const pages: FixedLayoutPageDescriptor[] = [];
      const pagesByNumber = new Map<number, PDFPageProxy>();

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        pagesByNumber.set(pageNumber, page);
        pages.push({ pageNumber, width: viewport.width, height: viewport.height });
      }

      pagesByDocument.set(document, pagesByNumber);

      return pages;
    },
    getOutline(document) {
      return document.getOutline();
    },
    async renderPage(document, pageNumber) {
      const pages = pagesByDocument.get(document);
      const cachedPage = pages?.get(pageNumber);

      if (cachedPage) {
        return cachedPage;
      }

      const page = await document.getPage(pageNumber);
      pages?.set(pageNumber, page);

      return page;
    },
    releasePage(document, pageNumber) {
      pagesByDocument.get(document)?.delete(pageNumber);
    },
    async search(_document, query) {
      searchEventBus.dispatch('find', {
        source: findController,
        type: query.isContinuation ? 'again' : 'find',
        query: query.query,
        phraseSearch: true,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: query.direction === 'previous',
        matchDiacritics: false,
      });

      return undefined;
    },
    navigate(document, target) {
      return resolvePdfDestination(document, target.destination, target.pageWidth);
    },
    async release(document) {
      pagesByDocument.delete(document);
      await document.cleanup();
    },
  };

  return {
    adapter,
    findController,
    searchEventBus,
    setSearchDocument(document: PDFDocumentProxy | null) {
      findController.setDocument(document as never);
    },
    clearSearch() {
      searchEventBus.dispatch('findbarclose', { source: findController });
    },
    getCachedPage(document: PDFDocumentProxy, pageNumber: number) {
      return pagesByDocument.get(document)?.get(pageNumber);
    },
  };
}
