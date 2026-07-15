export type FixedLayoutPageDescriptor = {
  pageNumber: number;
  width: number;
  height: number;
};

export type FixedLayoutDocumentAdapter<Document, Outline, SearchResult> = {
  load: () => Promise<Document>;
  getPages: (document: Document) => Promise<FixedLayoutPageDescriptor[]>;
  getOutline: (document: Document) => Promise<Outline>;
  release: (document: Document) => Promise<void>;
  renderPage?: (document: Document, pageNumber: number) => Promise<void>;
  releasePage?: (document: Document, pageNumber: number) => void;
  search?: (document: Document, query: string) => Promise<SearchResult>;
  navigate?: (document: Document, target: unknown) => Promise<number | undefined>;
};

export function createFixedLayoutDocumentLifecycle<Document, Outline, SearchResult>(
  adapter: FixedLayoutDocumentAdapter<Document, Outline, SearchResult>,
) {
  let document: Document | undefined;
  let generation = 0;

  return {
    async load() {
      const currentGeneration = ++generation;
      const nextDocument = await adapter.load();

      if (currentGeneration !== generation) {
        await adapter.release(nextDocument);
        return undefined;
      }

      const [pages, outline] = await Promise.all([
        adapter.getPages(nextDocument),
        adapter.getOutline(nextDocument),
      ]);

      if (currentGeneration !== generation) {
        await adapter.release(nextDocument);
        return undefined;
      }

      const previousDocument = document;
      document = nextDocument;
      if (previousDocument) {
        await adapter.release(previousDocument);
      }

      return { document: nextDocument, pages, outline };
    },
    async release() {
      generation += 1;
      const currentDocument = document;
      document = undefined;
      if (currentDocument) {
        await adapter.release(currentDocument);
      }
    },
  };
}
