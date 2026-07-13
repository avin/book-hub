type DjVuTask<T> = {
  run(): Promise<T>;
};

type DjVuDocumentProxy = {
  isBundled(): DjVuTask<boolean>;
  getPagesSizes(): DjVuTask<DjVuPageSize[]>;
  getPagesQuantity(): DjVuTask<number>;
  getContents(): DjVuTask<DjVuContentsEntry[] | null>;
  getPageNumberByUrl(url: string): DjVuTask<number | null>;
  getPage(pageNumber: number): {
    getText(): DjVuTask<string | null>;
    getNormalizedTextZones(): DjVuTask<DjVuTextZone[] | null>;
    createPngObjectUrl(): DjVuTask<DjVuPageImage>;
  };
};

export type DjVuWorker = {
  doc: DjVuDocumentProxy;
  createDocument(buffer: ArrayBuffer): Promise<void>;
  reset(): void;
  revokeObjectURL(url: string): void;
  worker: Worker;
};

export type DjVuPageSize = {
  width: number;
  height: number;
  dpi: number;
};

export type DjVuPageImage = DjVuPageSize & {
  url: string;
  byteLength: number;
};

export type DjVuTextZone = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

export type DjVuContentsEntry = {
  description: string;
  url: string;
  children?: DjVuContentsEntry[];
};

type DjVuLibrary = {
  VERSION: string;
  Worker: new () => DjVuWorker;
};

declare global {
  interface Window {
    DjVu?: DjVuLibrary;
  }
}

let libraryPromise: Promise<DjVuLibrary> | undefined;

function assetUrl() {
  return `${import.meta.env.BASE_URL}djvujs-assets/djvu.js`;
}

function loadLibrary() {
  if (window.DjVu?.VERSION === '0.5.4') {
    return Promise.resolve(window.DjVu);
  }

  libraryPromise ??= new Promise<DjVuLibrary>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = assetUrl();
    script.onload = () => {
      if (window.DjVu?.VERSION === '0.5.4') {
        resolve(window.DjVu);
        return;
      }

      libraryPromise = undefined;
      reject(new Error('DjVu.js 0.5.4 did not load'));
    };
    script.onerror = () => {
      libraryPromise = undefined;
      reject(new Error('Could not load DjVu.js'));
    };
    document.head.append(script);
  });

  return libraryPromise;
}

export async function createDjVuWorker() {
  const library = await loadLibrary();

  return new library.Worker();
}
