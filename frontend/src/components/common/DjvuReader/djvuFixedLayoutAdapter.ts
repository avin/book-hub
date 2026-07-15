import {
  createDjVuWorker,
  type DjVuContentsEntry,
  type DjVuPageImage,
  type DjVuTextZone,
  type DjVuWorker,
} from '@/api/djvujs';
import type { FixedLayoutDocumentAdapter } from '../FixedLayoutReader/fixedLayoutReader';

export type DjvuSearchQuery = { pageNumber: number };

export function createDjvuFixedLayoutAdapter(config: { fileUrl: () => string }) {
  const adapter: FixedLayoutDocumentAdapter<
    DjVuWorker,
    DjVuContentsEntry[] | null,
    DjVuPageImage,
    DjvuSearchQuery,
    DjVuTextZone[],
    string,
    number | undefined
  > = {
    async load() {
      let worker: DjVuWorker | undefined;

      try {
        worker = await createDjVuWorker();
        const response = await fetch(config.fileUrl());
        if (!response.ok) {
          throw new Error('Could not load DJVU');
        }

        await worker.createDocument(await response.arrayBuffer());
        if (!(await worker.doc.isBundled().run())) {
          throw new Error('Indirect DJVU is not supported');
        }

        return worker;
      } catch (error) {
        worker?.worker.terminate();
        throw error;
      }
    },
    async getPages(worker) {
      const sizes = await worker.doc.getPagesSizes().run();

      return sizes.map((size, index) => ({
        pageNumber: index + 1,
        width: size.width,
        height: size.height,
      }));
    },
    getOutline(worker) {
      return worker.doc.getContents().run();
    },
    renderPage(worker, pageNumber) {
      return worker.doc.getPage(pageNumber).createPngObjectUrl().run();
    },
    releasePage(worker, _pageNumber, pageImage) {
      if (pageImage) {
        worker.revokeObjectURL(pageImage.url);
      }
    },
    async search(worker, query) {
      return (await worker.doc.getPage(query.pageNumber).getNormalizedTextZones().run()) ?? [];
    },
    async navigate(worker, target) {
      return (await worker.doc.getPageNumberByUrl(target).run()) ?? undefined;
    },
    async release(worker) {
      worker.worker.terminate();
    },
  };

  return adapter;
}
