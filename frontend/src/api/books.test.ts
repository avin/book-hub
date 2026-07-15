import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiClient: {
    GET: vi.fn(),
    POST: vi.fn(),
    PATCH: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  getCsrfToken: vi.fn(),
}));

vi.mock('./client', () => mocks);

import {
  deleteBook,
  getBook,
  getReadingProgress,
  listBookTags,
  queryBooks,
  resetAllReadingProgress,
  updateBook,
  updateReadingProgress,
} from './books';

describe('books API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsrfToken.mockResolvedValue('csrf-token');
  });

  it('передаёт CSRF-токен при изменении данных и ограничивает прогресс', async () => {
    mocks.apiClient.PATCH.mockResolvedValue({ data: { id: 'book' } });
    mocks.apiClient.PUT.mockResolvedValue({ data: { progress_percent: 100 } });
    mocks.apiClient.DELETE.mockResolvedValue({});

    await expect(updateBook('book', { title: 'Новое название' })).resolves.toEqual({ id: 'book' });
    await expect(updateReadingProgress('book', 150)).resolves.toEqual({ progress_percent: 100 });
    await expect(deleteBook('book')).resolves.toBeUndefined();
    await expect(resetAllReadingProgress()).resolves.toBeUndefined();

    expect(mocks.apiClient.PATCH).toHaveBeenCalledWith('/v1/books/{book_id}', {
      body: { title: 'Новое название' },
      params: { path: { book_id: 'book' }, header: { 'X-CSRF-Token': 'csrf-token' } },
    });
    expect(mocks.apiClient.PUT).toHaveBeenCalledWith('/v1/books/{book_id}/progress', {
      body: { progress_percent: 100 },
      params: { path: { book_id: 'book' }, header: { 'X-CSRF-Token': 'csrf-token' } },
    });
  });

  it('возвращает данные чтения и сообщает о пустом ответе', async () => {
    mocks.apiClient.GET.mockResolvedValueOnce({ data: { id: 'book' } })
      .mockResolvedValueOnce({ data: { progress_percent: 42 } })
      .mockResolvedValueOnce({ data: ['fiction'] })
      .mockResolvedValueOnce({});

    await expect(getBook('book')).resolves.toEqual({ id: 'book' });
    await expect(getReadingProgress('book')).resolves.toEqual({ progress_percent: 42 });
    await expect(listBookTags()).resolves.toEqual(['fiction']);
    await expect(getBook('missing')).rejects.toThrow('Book response is empty');
  });

  it('отправляет поисковый запрос с CSRF-токеном и пробрасывает ошибку сервера', async () => {
    mocks.apiClient.POST.mockResolvedValueOnce({
      data: { items: [], total: 0, limit: 24, offset: 0 },
    });
    mocks.apiClient.POST.mockResolvedValueOnce({ error: new Error('denied') });

    await expect(queryBooks({ q: 'книга', offset: 0, limit: 24 })).resolves.toMatchObject({
      total: 0,
    });
    await expect(queryBooks({ q: '', offset: 0, limit: 24 })).rejects.toThrow('denied');
    expect(mocks.apiClient.POST).toHaveBeenCalledWith('/v1/books/query', {
      body: { q: '', offset: 0, limit: 24 },
      params: { header: { 'X-CSRF-Token': 'csrf-token' } },
    });
  });
});
