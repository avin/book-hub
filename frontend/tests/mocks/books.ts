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
  {
    id: '00000000-0000-0000-0000-000000000105',
    title: 'Высокий PDF для проверки',
    tags: ['тест'],
    favorite: false,
    format: 'pdf',
    size_bytes: 8192,
    progress_percent: 0,
    created_at: '2025-01-06T00:00:00Z',
    last_opened_at: '2025-01-06T00:00:00Z',
    updated_at: '2025-01-06T00:00:00Z',
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
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB для проверки</dc:title><dc:creator>Автор EPUB</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="styles" href="styles.css" media-type="text/css"/><item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/><item id="illustration" href="illustration.svg" media-type="image/svg+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/><itemref idref="notes" linear="no"/></spine></package>`,
  ),
  'OEBPS/nav.xhtml': strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#chapter">Глава EPUB</a></li></ol></nav></body></html>`,
  ),
  'OEBPS/cover.xhtml': strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>\n  <img src="cover.svg" alt="Обложка EPUB"/>\n</p></body></html>`,
  ),
  'OEBPS/chapter.xhtml': strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><link rel="stylesheet" href="styles.css"/></head><body><section id="chapter"><h1>Глава EPUB</h1><p>Текст EPUB с <strong>выделением</strong> и <a href="#target">ссылкой</a>.</p><div class="tx">Текст EPUB в блочном контейнере.</div><figure><img src="illustration.svg" alt="Иллюстрация EPUB"/></figure><div class="center"><span epub:type="pagebreak" title="171" id="Page_171">171</span></div><p class="italic">Курсивная строка<br/>со вторым рядом.</p><p class="pre-line">Первая строка&#10;Вторая строка.</p><p class="nowrap">Оченьдлинноесловодляпроверкипереносовстроквчиталке.</p><p class="blocked" style="font-weight: bold">Оформление без шрифта издателя.</p><p id="target">Цель ссылки.</p><p>Сноска <a type="note" href="notes.xhtml#note">[1]</a>.</p><table><tr><td>Текст таблицы</td></tr></table></section></body></html>`,
  ),
  'OEBPS/notes.xhtml': strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><aside id="note"><p>Текст EPUB-сноски.</p></aside></body></html>`,
  ),
  'OEBPS/cover.svg': strToU8(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120" viewBox="0 0 80 120"><rect width="80" height="120" fill="#476"/></svg>',
  ),
  'OEBPS/illustration.svg': strToU8(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40"><rect width="80" height="40" fill="#764"/></svg>',
  ),
  'OEBPS/styles.css': strToU8(
    `.center { text-align: center; } .italic { font-style: italic; } .pre-line { white-space: pre-line; } .nowrap { white-space: nowrap; } .blocked { font-family: "Недопустимый шрифт"; font-size: 200px; color: red; background: black; position: fixed; }`,
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

function buildPdf(objects: string[]) {
  const encoder = new TextEncoder();
  let result = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(encoder.encode(result).byteLength);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = encoder.encode(result).byteLength;
  result += `xref\n0 ${objects.length + 1}\n`;
  result += '0000000000 65535 f \n';
  result += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  result += `startxref\n${xrefOffset}\n%%EOF`;

  return result;
}

function tallPdfPageStream(pageNumber: number) {
  const colors = [
    ['0.90 0.20 0.20', '0.20 0.35 0.90'],
    ['0.20 0.65 0.30', '0.80 0.35 0.10'],
    ['0.55 0.20 0.75', '0.10 0.65 0.65'],
    ['0.85 0.65 0.10', '0.25 0.25 0.25'],
    ['0.15 0.50 0.85', '0.80 0.20 0.55'],
  ][pageNumber - 1];
  const content = `q ${colors[0]} rg 0 5700 360 300 re f ${colors[1]} rg 0 0 360 300 re f Q BT /F1 32 Tf 42 5400 Td (Tall page ${pageNumber}) Tj /F1 18 Tf 0 -2600 Td (Middle marker ${pageNumber}) Tj 0 -2600 Td (Bottom marker ${pageNumber}) Tj ET`;

  return `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}\nendstream`;
}

const tallPdfPageCount = 5;
const tallPdfPageObjectStart = 3;
const tallPdfFontObject = tallPdfPageObjectStart + tallPdfPageCount;
const tallPdfContentObjectStart = tallPdfFontObject + 1;
const tallPdfObjects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${Array.from({ length: tallPdfPageCount }, (_, index) => `${tallPdfPageObjectStart + index} 0 R`).join(' ')}] /Count ${tallPdfPageCount} >>`,
  ...Array.from(
    { length: tallPdfPageCount },
    (_, index) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 6000] /Resources << /Font << /F1 ${tallPdfFontObject} 0 R >> >> /Contents ${tallPdfContentObjectStart + index} 0 R >>`,
  ),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ...Array.from({ length: tallPdfPageCount }, (_, index) => tallPdfPageStream(index + 1)),
];

export const tallPdfFile = buildPdf(tallPdfObjects);

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
