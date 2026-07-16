export type FixedLayoutPageDescriptor = {
  pageNumber: number;
  width: number;
  height: number;
};

export type FixedLayoutDocumentAdapter<
  Document,
  Outline,
  PageResource,
  SearchQuery,
  SearchResult,
  NavigationTarget,
  NavigationResult,
> = {
  load: () => Promise<Document>;
  getPages: (document: Document) => Promise<FixedLayoutPageDescriptor[]>;
  getOutline: (document: Document) => Promise<Outline>;
  renderPage: (document: Document, pageNumber: number) => Promise<PageResource>;
  releasePage: (
    document: Document,
    pageNumber: number,
    resource: PageResource | undefined,
  ) => void | Promise<void>;
  search: (document: Document, query: SearchQuery) => Promise<SearchResult>;
  navigate: (document: Document, target: NavigationTarget) => Promise<NavigationResult>;
  release: (document: Document) => Promise<void>;
};

export function createFixedLayoutReader<
  Document,
  Outline,
  PageResource,
  SearchQuery,
  SearchResult,
  NavigationTarget,
  NavigationResult,
>(
  adapter: FixedLayoutDocumentAdapter<
    Document,
    Outline,
    PageResource,
    SearchQuery,
    SearchResult,
    NavigationTarget,
    NavigationResult
  >,
) {
  let document: Document | undefined;
  let generation = 0;
  let documentGeneration = 0;

  const isCurrentDocument = (candidate: Document, candidateGeneration: number) =>
    document === candidate &&
    generation === candidateGeneration &&
    documentGeneration === candidateGeneration;

  return {
    async load() {
      const currentGeneration = ++generation;
      const nextDocument = await adapter.load();

      if (currentGeneration !== generation) {
        await adapter.release(nextDocument);
        return undefined;
      }

      let pages: FixedLayoutPageDescriptor[];
      let outline: Outline;

      try {
        [pages, outline] = await Promise.all([
          adapter.getPages(nextDocument),
          adapter.getOutline(nextDocument),
        ]);
      } catch (error) {
        await adapter.release(nextDocument);
        throw error;
      }

      if (currentGeneration !== generation) {
        await adapter.release(nextDocument);
        return undefined;
      }

      const previousDocument = document;
      document = nextDocument;
      documentGeneration = currentGeneration;
      if (previousDocument) {
        await adapter.release(previousDocument);
      }

      return { document: nextDocument, pages, outline };
    },
    async renderPage(pageNumber: number) {
      const currentDocument = document;
      const currentGeneration = generation;

      if (!currentDocument || documentGeneration !== currentGeneration) {
        return undefined;
      }

      const resource = await adapter.renderPage(currentDocument, pageNumber);

      if (!isCurrentDocument(currentDocument, currentGeneration)) {
        await adapter.releasePage(currentDocument, pageNumber, resource);
        return undefined;
      }

      return resource;
    },
    async releasePage(pageNumber: number, resource?: PageResource) {
      const currentDocument = document;

      if (currentDocument && documentGeneration === generation) {
        await adapter.releasePage(currentDocument, pageNumber, resource);
      }
    },
    async search(query: SearchQuery) {
      const currentDocument = document;
      const currentGeneration = generation;

      if (!currentDocument || documentGeneration !== currentGeneration) {
        return undefined;
      }

      const result = await adapter.search(currentDocument, query);

      return isCurrentDocument(currentDocument, currentGeneration) ? result : undefined;
    },
    async navigate(target: NavigationTarget) {
      const currentDocument = document;
      const currentGeneration = generation;

      if (!currentDocument || documentGeneration !== currentGeneration) {
        return undefined;
      }

      const result = await adapter.navigate(currentDocument, target);

      return isCurrentDocument(currentDocument, currentGeneration) ? result : undefined;
    },
    async release() {
      generation += 1;
      const currentDocument = document;
      document = undefined;
      documentGeneration = 0;
      if (currentDocument) {
        await adapter.release(currentDocument);
      }
    },
  };
}
