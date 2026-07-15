import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/solid-query';
import { render } from '@solidjs/testing-library';
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
  type Book,
  type BookListResponse,
  createUpdateBookMutation,
  updateBook,
  updateReadingProgress,
} from './books';

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book',
    title: 'Книга',
    tags: [],
    favorite: false,
    format: 'fb2',
    size_bytes: 1,
    progress_percent: 0,
    created_at: '2026-01-01T00:00:00Z',
    last_opened_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function list(items: Book[]): BookListResponse {
  return { items, total: items.length, limit: 24, offset: 0 };
}

function renderUpdateBookMutation(queryClient: QueryClient) {
  let mutation: ReturnType<typeof createUpdateBookMutation> | undefined;

  render(() =>
    QueryClientProvider({
      client: queryClient,
      get children() {
        mutation = createUpdateBookMutation();
        return null;
      },
    }),
  );

  if (!mutation) {
    throw new Error('Update-book mutation was not created');
  }

  return mutation;
}

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

  it('обновляет обычные списки в cache без invalidation, сохраняя фильтр избранного', async () => {
    const queryClient = new QueryClient();
    const allQuery = { q: '', offset: 0, limit: 24, favorite: null };
    const favoritesQuery = { q: '', offset: 0, limit: 24, favorite: true };
    queryClient.setQueryData(['books', allQuery], list([book({ favorite: true })]));
    queryClient.setQueryData(['books', favoritesQuery], list([book({ favorite: true })]));
    mocks.apiClient.PATCH.mockResolvedValue({
      data: book({ favorite: false, title: 'Обновлена' }),
    });

    await renderUpdateBookMutation(queryClient).mutateAsync({
      bookId: 'book',
      patch: { favorite: false },
      invalidateBooks: false,
    });

    expect(queryClient.getQueryData<BookListResponse>(['books', allQuery])).toMatchObject({
      items: [{ title: 'Обновлена', favorite: false }],
      total: 1,
    });
    expect(queryClient.getQueryData<BookListResponse>(['books', favoritesQuery])).toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('обновляет все страницы infinite-списка в cache без invalidation', async () => {
    const queryClient = new QueryClient();
    const query = { q: '', offset: 0, limit: 24, favorite: null };
    const cached: InfiniteData<BookListResponse> = {
      pages: [list([book()]), list([book({ id: 'second' })])],
      pageParams: [0, 24],
    };
    queryClient.setQueryData(['books', query], cached);
    mocks.apiClient.PATCH.mockResolvedValue({ data: book({ title: 'Обновлена' }) });

    await renderUpdateBookMutation(queryClient).mutateAsync({
      bookId: 'book',
      patch: { title: 'Обновлена' },
      invalidateBooks: false,
    });

    expect(
      queryClient.getQueryData<InfiniteData<BookListResponse>>(['books', query]),
    ).toMatchObject({
      pages: [{ items: [{ title: 'Обновлена' }] }, { items: [{ id: 'second' }] }],
      pageParams: [0, 24],
    });
  });
});
