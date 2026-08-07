import { createPdfiumWorkerEngine } from '@embedpdf/engines/pdfium';

function basePrefix() {
  const base = import.meta.env.BASE_URL;
  if (!base || base === '/') {
    return '/';
  }

  return `/${base.replace(/^\/+|\/+$/g, '')}/`;
}

export const pdfiumWasmUrl = new URL(
  `${basePrefix()}pdfium-assets/pdfium.wasm`,
  window.location.origin,
).href;

let sharedEngine: ReturnType<typeof createPdfiumWorkerEngine> | undefined;

export function getPdfiumEngine() {
  sharedEngine ??= createPdfiumWorkerEngine(pdfiumWasmUrl, {
    encoderPoolSize: 0,
    fontFallback: null,
  });

  return sharedEngine;
}
