import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const assetUrl = 'https://djvu.js.org/assets/dist/djvu.js';
const expectedSha256 = '10a831d62cc7ced39c30c7350a11410402d082a0f0a5b073a88d3d7ca662add3';
const outputPath = resolve(root, 'public/djvujs-assets/djvu.js');

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function isCurrentAsset() {
  try {
    return sha256(await readFile(outputPath)) === expectedSha256;
  } catch {
    return false;
  }
}

async function main() {
  if (await isCurrentAsset()) {
    return;
  }

  const response = await fetch(assetUrl);

  if (!response.ok) {
    throw new Error(`Could not download DjVu.js asset: ${response.status} ${response.statusText}`);
  }

  const content = Buffer.from(await response.arrayBuffer());

  if (sha256(content) !== expectedSha256) {
    throw new Error('Downloaded DjVu.js asset does not match the expected SHA-256 checksum');
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, content);
  await rm(outputPath, { force: true });
  await rename(temporaryPath, outputPath);
  console.log('Synced DjVu.js 0.5.4 asset to public/djvujs-assets');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
