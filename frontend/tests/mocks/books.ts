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
