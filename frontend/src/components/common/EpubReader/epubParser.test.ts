import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractEpubMetadata, parseEpub, validateEpub } from './epubParser';

function sampleEpub(images: Record<string, Uint8Array<ArrayBuffer>> = {}) {
  const imageManifest = Object.keys(images)
    .map(
      (name, index) =>
        `<item id="image-${index}" href="${name}" media-type="${name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'}"${index === 0 ? ' properties="cover-image"' : ''}/>`,
    )
    .join('');
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`,
    ),
    'OPS/book.opf': strToU8(
      `<?xml version="1.0"?><package><metadata><title>EPUB-книга</title><creator>Автор</creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${imageManifest}</manifest><spine><itemref idref="chapter"/></spine></package>`,
    ),
    'OPS/chapter.xhtml': strToU8(
      '<html><body><h1 id="start">Начало</h1><p>Текст книги</p></body></html>',
    ),
    'OPS/nav.xhtml': strToU8(
      '<html><body><nav role="doc-toc"><ol><li><a href="chapter.xhtml#start">Начало</a></li></ol></nav></body></html>',
    ),
    ...Object.fromEntries(Object.entries(images).map(([name, bytes]) => [`OPS/${name}`, bytes])),
  });
}

describe('epubParser', () => {
  it('валидирует и разбирает безопасную reflowable EPUB-книгу', async () => {
    const epub = new Blob([sampleEpub()]);
    await expect(validateEpub(epub)).resolves.toMatchObject({ entryCount: 5 });

    const document = await parseEpub(epub);
    expect(document.title).toBe('EPUB-книга');
    expect(document.authors).toEqual(['Автор']);
    expect(document.blocks.some((block) => block.kind === 'title')).toBe(true);
    expect(document.outline).toEqual([
      { label: 'Начало', targetId: 'epub-target:OPS/chapter.xhtml#start', children: undefined },
    ]);
    await expect(extractEpubMetadata(epub)).resolves.toMatchObject({ title: 'EPUB-книга' });
  });

  it('отклоняет архив без обязательного mimetype', async () => {
    await expect(parseEpub(new Blob([zipSync({ 'book.txt': strToU8('text') })]))).rejects.toThrow(
      'EPUB container is missing',
    );
  });

  it('сохраняет произвольные байты иллюстрации и обложки без потерь', async () => {
    const bytes = Uint8Array.from({ length: 65_543 }, (_, index) => index % 256);
    const document = await parseEpub(new Blob([sampleEpub({ 'cover.png': bytes })]));
    const cover = document.coverBinary!;

    expect(cover.contentType).toBe('image/png');
    expect(document.binaries.get(document.coverImageId!)).toBe(cover);
    expect(Uint8Array.from(atob(cover.data), (char) => char.charCodeAt(0))).toEqual(bytes);
  });

  it('кодирует безопасный SVG и исключает SVG с активным содержимым', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="10"/></svg>';
    const document = await parseEpub(
      new Blob([
        sampleEpub({
          'safe.svg': strToU8(svg),
          'script.svg': strToU8('<svg><script>alert(1)</script></svg>'),
          'external.svg': strToU8('<svg><image href="https://example.com/image.png"/></svg>'),
        }),
      ]),
    );

    expect([...document.binaries.keys()]).toEqual(['epub-resource:OPS/safe.svg']);
    expect(atob(document.coverBinary!.data)).toBe(svg);
  });
});
