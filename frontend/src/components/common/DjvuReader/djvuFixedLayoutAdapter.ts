import { createDjVuWorker, type DjVuContentsEntry, type DjVuWorker } from '@/api/djvujs';
import type { FixedLayoutDocumentAdapter } from '../FixedLayoutReader/fixedLayoutDocument';

export function createDjvuFixedLayoutAdapter(config: { fileUrl: () => string }) {
  const adapter: FixedLayoutDocumentAdapter<DjVuWorker, DjVuContentsEntry[] | null, never> = {
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
    async release(worker) {
      worker.worker.terminate();
    },
  };

  return adapter;
}
