import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractEpubMetadata, parseEpub, validateEpub } from './epubParser';

function sampleEpub() {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`,
    ),
    'OPS/book.opf': strToU8(
      `<?xml version="1.0"?><package><metadata><title>EPUB-книга</title><creator>Автор</creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
    ),
    'OPS/chapter.xhtml': strToU8(
      '<html><body><h1 id="start">Начало</h1><p>Текст книги</p></body></html>',
    ),
    'OPS/nav.xhtml': strToU8(
      '<html><body><nav role="doc-toc"><ol><li><a href="chapter.xhtml#start">Начало</a></li></ol></nav></body></html>',
    ),
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
});
