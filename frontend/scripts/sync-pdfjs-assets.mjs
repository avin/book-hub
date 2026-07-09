import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pdfjsDistDir = resolve(root, 'node_modules/pdfjs-dist');
const outDir = resolve(root, 'public/pdfjs-assets');

const assetExtensions = new Set(['.wasm', '.bcmap', '.ttf', '.js', '.mjs']);

async function copyDir(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destPath = resolve(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, destPath);
    } else if (assetExtensions.has(extname(entry.name).toLowerCase())) {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(sourcePath, destPath);
    }
  }
}

async function main() {
  try {
    await stat(pdfjsDistDir);
  } catch {
    console.warn('pdfjs-dist is not installed, skipping pdf.js asset sync');
    return;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const dir of ['wasm', 'cmaps', 'standard_fonts']) {
    await copyDir(resolve(pdfjsDistDir, dir), resolve(outDir, dir));
  }

  await copyFile(resolve(pdfjsDistDir, 'build/pdf.worker.mjs'), resolve(outDir, 'pdf.worker.mjs'));

  console.log('Synced pdf.js assets to public/pdfjs-assets');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
