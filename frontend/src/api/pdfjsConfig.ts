function basePrefix() {
  const base = import.meta.env.BASE_URL;
  if (!base || base === "/") {
    return "/";
  }
  return `/${base.replace(/^\/+|\/+$/g, "")}/`;
}

const assetsBase = `${basePrefix()}pdfjs-assets/`;

export const pdfjsWorkerSrc = `${assetsBase}pdf.worker.mjs`;

export const pdfjsDocumentParams = {
  cMapUrl: `${assetsBase}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assetsBase}standard_fonts/`,
  wasmUrl: `${assetsBase}wasm/`,
} as const;
