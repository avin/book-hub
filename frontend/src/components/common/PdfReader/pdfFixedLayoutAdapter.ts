import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { pdfjsDocumentParams } from '@/api/pdfjsConfig';
import type {
  FixedLayoutDocumentAdapter,
  FixedLayoutPageDescriptor,
} from '../FixedLayoutReader/fixedLayoutDocument';

export function createPdfFixedLayoutAdapter(config: {
  fileUrl: () => string;
  onLoadingTask: (task: PDFDocumentLoadingTask) => void;
}) {
  const pagesByDocument = new WeakMap<PDFDocumentProxy, Map<number, PDFPageProxy>>();
  const adapter: FixedLayoutDocumentAdapter<
    PDFDocumentProxy,
    Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
    never
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
    async release(document) {
      pagesByDocument.delete(document);
      await document.cleanup();
    },
  };

  return {
    adapter,
    getCachedPage(document: PDFDocumentProxy, pageNumber: number) {
      return pagesByDocument.get(document)?.get(pageNumber);
    },
  };
}
