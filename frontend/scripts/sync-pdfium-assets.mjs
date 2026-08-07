import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pdfiumDistDir = resolve(root, 'node_modules/@embedpdf/pdfium/dist');
const outDir = resolve(root, 'public/pdfium-assets');

async function main() {
  try {
    await stat(pdfiumDistDir);
  } catch {
    console.warn('@embedpdf/pdfium is not installed, skipping PDFium asset sync');
    return;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyFile(resolve(pdfiumDistDir, 'pdfium.wasm'), resolve(outDir, 'pdfium.wasm'));

  console.log('Synced PDFium assets to public/pdfium-assets');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
