import { strToU8, zipSync } from 'fflate';

export const items = [
  {
    id: '00000000-0000-0000-0000-000000000101',
    title: 'Война и мир',
    tags: ['классика', 'роман'],
    favorite: true,
    format: 'fb2',
    size_bytes: 2048,
    progress_percent: 42,
    created_at: '2025-01-01T00:00:00Z',
    last_opened_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000102',
    title: 'Мастер и Маргарита',
    tags: ['роман'],
    favorite: false,
    format: 'pdf',
    size_bytes: 4096,
    progress_percent: 0,
    created_at: '2025-01-03T00:00:00Z',
    last_opened_at: '2025-01-03T00:00:00Z',
    updated_at: '2025-01-03T00:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000103',
    title: 'PDF с оглавлением',
    tags: ['тест'],
    favorite: false,
    format: 'pdf',
    size_bytes: 2048,
    progress_percent: 0,
    created_at: '2025-01-04T00:00:00Z',
    last_opened_at: '2025-01-04T00:00:00Z',
    updated_at: '2025-01-04T00:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000104',
    title: 'EPUB для проверки',
    tags: ['тест'],
    favorite: false,
    format: 'epub',
    size_bytes: 2048,
    progress_percent: 0,
    created_at: '2025-01-05T00:00:00Z',
    last_opened_at: '2025-01-05T00:00:00Z',
    updated_at: '2025-01-05T00:00:00Z',
  },
];

export const tags = {
  items: ['классика', 'роман', 'фантастика'],
};

const chapters = Array.from({ length: 80 }, (_, index) => {
  const title = index === 0 ? 'Глава первая' : `Глава ${index + 1}`;
  const paragraphs = Array.from(
    { length: 5 },
    (_, paragraphIndex) =>
      `<p>Глава ${index + 1}, абзац ${paragraphIndex + 1}. Это достаточно длинный текст для проверки виртуальной раскладки, изменения ширины документа, шрифта и восстановления позиции чтения после пересчёта высот блоков.</p>`,
  ).join('');

  const noteLink = index === 0 ? `<p>Сноска<a l:href="#note-1" type="note">[1]</a></p>` : '';

  return `<section id="chapter-${index + 1}"><title><p>${title}</p></title>${paragraphs}${noteLink}</section>`;
}).join('');

export const fb2File = `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink"><description><title-info><book-title>Война и мир</book-title><author><first-name>Лев</first-name><last-name>Толстой</last-name></author></title-info></description><body>${chapters}</body><body name="notes"><section id="note-1"><title><p>Сноска</p></title><p>Текст тестовой сноски.</p></section></body></FictionBook>`;

export const epubFile = zipSync({
  mimetype: strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  ),
  'OEBPS/content.opf': strToU8(
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB для проверки</dc:title><dc:creator>Автор EPUB</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
  ),
  'OEBPS/nav.xhtml': strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#chapter">Глава EPUB</a></li></ol></nav></body></html>`,
  ),
  'OEBPS/chapter.xhtml': strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><section id="chapter"><h1>Глава EPUB</h1><p>Текст EPUB с <strong>выделением</strong> и <a href="#target">ссылкой</a>.</p><div class="tx">Текст EPUB в блочном контейнере.</div><p id="target">Цель ссылки.</p><p>Сноска <a epub:type="noteref" href="#note">[1]</a>.</p><table><tr><td>Текст таблицы</td></tr></table><aside id="note"><p>Текст EPUB-сноски.</p></aside></section></body></html>`,
  ),
});

export const pdfFile = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 520] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 87 >>
stream
BT /F1 24 Tf 56 420 Td (Book Hub PDF) Tj /F1 12 Tf 0 -32 Td (Reader story sample) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
448
%%EOF`;

export const pdfFileWithOutline = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 520] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 520] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 50 400 Td (Page One) Tj ET
endstream
endobj
7 0 obj
<< /Length 45 >>
stream
BT /F1 18 Tf 50 400 Td (Page Two) Tj ET
endstream
endobj
8 0 obj
<< /Type /Outlines /First 9 0 R /Last 9 0 R /Count 1 >>
endobj
9 0 obj
<< /Title (Second page) /Parent 8 0 R /Dest [4 0 R /XYZ 0 400 0] >>
endobj
xref
0 10
0000000000 65535 f 
0000000009 00000 n 
0000000074 00000 n 
0000000137 00000 n 
0000000263 00000 n 
0000000389 00000 n 
0000000459 00000 n 
0000000548 00000 n 
0000000637 00000 n 
0000000708 00000 n 
trailer
<< /Size 10 /Root 1 0 R >>
startxref
791
%%EOF`;

export const pdfFileWithoutText = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 520] /Contents 5 0 R >>
endobj
5 0 obj
<< /Length 87 >>
stream
q 0.5 g 56 400 240 30 re f Q${' '.repeat(59)}
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000000 00000 f
0000000216 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
353
%%EOF`;

export const req = {
  list: { method: 'POST', path: '/v1/books/query' },
  tags: { method: 'GET', path: '/v1/books/tags' },
  item: (bookId: string) => ({ method: 'GET', path: `/v1/books/${bookId}` }),
  update: (bookId: string) => ({ method: 'PATCH', path: `/v1/books/${bookId}` }),
  remove: (bookId: string) => ({ method: 'DELETE', path: `/v1/books/${bookId}` }),
  upload: { method: 'POST', path: '/v1/books' },
  file: (bookId: string) => ({ method: 'GET', path: `/v1/books/${bookId}/file` }),
  cover: (bookId: string) => ({ method: 'GET', path: `/v1/books/${bookId}/cover` }),
  progress: (bookId: string) => ({ method: 'GET', path: `/v1/books/${bookId}/progress` }),
  updateProgress: (bookId: string) => ({ method: 'PUT', path: `/v1/books/${bookId}/progress` }),
  resetProgress: (bookId: string) => ({ method: 'DELETE', path: `/v1/books/${bookId}/progress` }),
} as const;
