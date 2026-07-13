import {
  createMutation,
  createQuery,
  type InfiniteData,
  type QueryClient,
  useQueryClient,
} from '@tanstack/solid-query';
import type { components } from '@/api/generated/schema';
import { readFb2BlobText } from '@/components/common/Fb2Reader/fb2TextDecoder';
import { apiClient, getCsrfToken } from './client';
import { getApiBaseUrl } from './baseUrl';

export type Book = components['schemas']['Book'];
export type BookListResponse = components['schemas']['BookListResponse'];
export type BookPatchRequest = components['schemas']['BookPatchRequest'];
export type BookQueryRequest = components['schemas']['BookQueryRequest'];
export type BookSort = components['schemas']['BookSort'];
export type ReadingProgress = components['schemas']['ReadingProgress'];

export const booksQueryKey = ['books'] as const;
export const bookTagsQueryKey = ['book-tags'] as const;

export function getBookFileUrl(bookId: string) {
  return `${getApiBaseUrl()}/v1/books/${encodeURIComponent(bookId)}/file`;
}

export function getBookDownloadUrl(bookId: string) {
  return `${getBookFileUrl(bookId)}?download=1`;
}

export function getBookDownloadName(book: Pick<Book, 'title' | 'format'>) {
  const title =
    book.title
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\.+$/g, '') || 'book';
  return `${title}.${book.format}`;
}

export type BookCoverVariant = 'full' | 'thumbnail';

export function getBookCoverUrl(bookId: string, variant: BookCoverVariant = 'full') {
  const url = `${getApiBaseUrl()}/v1/books/${encodeURIComponent(bookId)}/cover`;
  return variant === 'full' ? url : `${url}?variant=${variant}`;
}

async function responseError(response: Response) {
  try {
    return await response.json();
  } catch {
    return new Error(`HTTP ${response.status}`);
  }
}

export async function queryBooks(query: BookQueryRequest) {
  const csrfToken = await getCsrfToken();
  const { data, error } = await apiClient.POST('/v1/books/query', {
    body: query,
    params: {
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error('Books response is empty');
  }

  return data;
}

export async function listBookTags() {
  const { data, error } = await apiClient.GET('/v1/books/tags');

  if (error || !data) {
    throw error ?? new Error('Book tags response is empty');
  }

  return data;
}

export function createBookTagsQuery() {
  return createQuery(() => ({
    queryKey: bookTagsQueryKey,
    queryFn: listBookTags,
  }));
}

function isBooksQueryKey(
  queryKey: readonly unknown[],
): queryKey is readonly ['books', BookQueryRequest] {
  return (
    queryKey[0] === booksQueryKey[0] && typeof queryKey[1] === 'object' && queryKey[1] !== null
  );
}

function updateBookListCache(
  list: BookListResponse | undefined,
  query: BookQueryRequest,
  book: Book,
) {
  if (!list) {
    return list;
  }

  const bookIndex = list.items.findIndex((item) => item.id === book.id);

  if (bookIndex === -1) {
    return list;
  }

  if (query.favorite !== null && query.favorite !== undefined && query.favorite !== book.favorite) {
    return {
      ...list,
      items: list.items.filter((item) => item.id !== book.id),
      total: Math.max(0, list.total - 1),
    };
  }

  return {
    ...list,
    items: list.items.map((item) => (item.id === book.id ? book : item)),
  };
}

function isInfiniteBookListResponse(data: unknown): data is InfiniteData<BookListResponse> {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { pages?: unknown }).pages)
  );
}

function updateBooksCacheData(
  data: BookListResponse | InfiniteData<BookListResponse> | undefined,
  query: BookQueryRequest,
  book: Book,
) {
  if (!data) {
    return data;
  }

  if (isInfiniteBookListResponse(data)) {
    return {
      ...data,
      pages: data.pages.map((page) => updateBookListCache(page, query, book) ?? page),
    };
  }

  return updateBookListCache(data, query, book);
}

function updateCachedBookLists(queryClient: QueryClient, book: Book) {
  for (const [queryKey] of queryClient.getQueriesData<
    BookListResponse | InfiniteData<BookListResponse>
  >({
    queryKey: booksQueryKey,
  })) {
    if (!isBooksQueryKey(queryKey)) {
      continue;
    }

    queryClient.setQueryData<BookListResponse | InfiniteData<BookListResponse>>(queryKey, (data) =>
      updateBooksCacheData(data, queryKey[1], book),
    );
  }
}

function updateBookProgressCache(
  queryClient: QueryClient,
  bookId: string,
  progressPercent: number,
  updateLastOpenedAt = true,
) {
  const lastOpenedAt = updateLastOpenedAt ? new Date().toISOString() : undefined;
  const updateBook = (book: Book) =>
    book.id === bookId
      ? {
          ...book,
          progress_percent: progressPercent,
          ...(lastOpenedAt && {
            last_opened_at: book.last_opened_at > lastOpenedAt ? book.last_opened_at : lastOpenedAt,
          }),
        }
      : book;
  const compareByRelevance = (left: Book, right: Book) =>
    Date.parse(right.last_opened_at) - Date.parse(left.last_opened_at) ||
    Date.parse(right.created_at) - Date.parse(left.created_at) ||
    left.id.localeCompare(right.id);

  queryClient.setQueryData<Book>(['book', bookId], (book) => (book ? updateBook(book) : book));

  for (const [queryKey] of queryClient.getQueriesData<
    BookListResponse | InfiniteData<BookListResponse>
  >({
    queryKey: booksQueryKey,
  })) {
    if (!isBooksQueryKey(queryKey)) {
      continue;
    }

    queryClient.setQueryData<BookListResponse | InfiniteData<BookListResponse>>(
      queryKey,
      (data) => {
        if (!data) {
          return data;
        }
        if (isInfiniteBookListResponse(data)) {
          if (queryKey[1].sort !== 'relevance') {
            return {
              ...data,
              pages: data.pages.map((page) => ({ ...page, items: page.items.map(updateBook) })),
            };
          }
          const pageSizes = data.pages.map((page) => page.items.length);
          const items = data.pages
            .flatMap((page) => page.items)
            .map(updateBook)
            .sort(compareByRelevance);
          let offset = 0;
          return {
            ...data,
            pages: data.pages.map((page, index) => {
              const nextOffset = offset + pageSizes[index];
              const updatedPage = { ...page, items: items.slice(offset, nextOffset) };
              offset = nextOffset;
              return updatedPage;
            }),
          };
        }

        const items = data.items.map(updateBook);
        return queryKey[1].sort === 'relevance'
          ? { ...data, items: items.sort(compareByRelevance) }
          : { ...data, items };
      },
    );
  }
}

export async function getBook(bookId: string) {
  const { data, error } = await apiClient.GET('/v1/books/{book_id}', {
    params: {
      path: {
        book_id: bookId,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error('Book response is empty');
  }

  return data;
}

export function createBookQuery(bookId: () => string) {
  return createQuery(() => ({
    queryKey: ['book', bookId()],
    queryFn: () => getBook(bookId()),
    enabled: Boolean(bookId()),
  }));
}

export async function uploadBook(input: {
  file: File;
  title?: string;
  tags: string[];
  favorite: boolean;
}) {
  const csrfToken = await getCsrfToken();
  const formData = new FormData();

  formData.append('file', input.file);
  if (input.title?.trim()) {
    formData.append('title', input.title.trim());
  }
  for (const tag of input.tags) {
    formData.append('tags', tag);
  }
  formData.append('favorite', String(input.favorite));

  const response = await fetch(`${getApiBaseUrl()}/v1/books`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrfToken,
    },
    body: formData,
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return (await response.json()) as Book;
}

export function createUploadBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: uploadBook,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
      void queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
    },
  }));
}

export async function updateBook(bookId: string, patch: BookPatchRequest) {
  const csrfToken = await getCsrfToken();
  const { data, error } = await apiClient.PATCH('/v1/books/{book_id}', {
    body: patch,
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error('Book update response is empty');
  }

  return data;
}

export function createUpdateBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; patch: BookPatchRequest; invalidateBooks?: boolean }) =>
      updateBook(input.bookId, input.patch),
    onSuccess: (book, input) => {
      queryClient.setQueryData(['book', book.id], book);
      if (input.invalidateBooks === false) {
        updateCachedBookLists(queryClient, book);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
      void queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
    },
  }));
}

export async function deleteBook(bookId: string) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE('/v1/books/{book_id}', {
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error) {
    throw error;
  }
}

export function createDeleteBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: deleteBook,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
      void queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
    },
  }));
}

export async function uploadBookCover(bookId: string, file: File) {
  const csrfToken = await getCsrfToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/v1/books/${encodeURIComponent(bookId)}/cover`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrfToken,
    },
    body: formData,
  });

  if (!response.ok) {
    throw await responseError(response);
  }
}

export function createUploadBookCoverMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; file: File }) =>
      uploadBookCover(input.bookId, input.file),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['book', input.bookId] });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export async function deleteBookCover(bookId: string) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE('/v1/books/{book_id}/cover', {
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error) {
    throw error;
  }
}

export function createDeleteBookCoverMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: deleteBookCover,
    onSuccess: (_data, bookId) => {
      void queryClient.invalidateQueries({ queryKey: ['book', bookId] });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export async function fetchBookFileText(bookId: string) {
  return readFb2BlobText(await fetchBookFileBlob(bookId));
}

export async function fetchBookFileBlob(bookId: string) {
  const response = await fetch(getBookFileUrl(bookId), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return response.blob();
}

export function createBookFileTextQuery(bookId: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: ['book-file-text', bookId()],
    queryFn: () => fetchBookFileText(bookId()),
    enabled: enabled() && Boolean(bookId()),
  }));
}

export function createBookFileBlobQuery(bookId: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: ['book-file-blob', bookId()],
    queryFn: () => fetchBookFileBlob(bookId()),
    enabled: enabled() && Boolean(bookId()),
  }));
}

export async function getReadingProgress(bookId: string) {
  const { data, error } = await apiClient.GET('/v1/books/{book_id}/progress', {
    params: {
      path: {
        book_id: bookId,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error('Progress response is empty');
  }

  return data;
}

export function createReadingProgressQuery(bookId: () => string) {
  return createQuery(() => ({
    queryKey: ['book-progress', bookId()],
    queryFn: () => getReadingProgress(bookId()),
    enabled: Boolean(bookId()),
    retry: false,
  }));
}

export async function updateReadingProgress(bookId: string, progressPercent: number) {
  const csrfToken = await getCsrfToken();
  const { data, error } = await apiClient.PUT('/v1/books/{book_id}/progress', {
    body: {
      progress_percent: Math.min(100, Math.max(0, progressPercent)),
    },
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error('Progress update response is empty');
  }

  return data;
}

export function createUpdateReadingProgressMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; progressPercent: number }) =>
      updateReadingProgress(input.bookId, input.progressPercent),
    onSuccess: (progress, input) => {
      queryClient.setQueryData(['book-progress', input.bookId], progress);
      updateBookProgressCache(queryClient, input.bookId, progress.progress_percent);
    },
  }));
}

export async function resetReadingProgress(bookId: string) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE('/v1/books/{book_id}/progress', {
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error) {
    throw error;
  }
}

export function createResetReadingProgressMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: resetReadingProgress,
    onSuccess: (_data, bookId) => {
      updateBookProgressCache(queryClient, bookId, 0, false);
      queryClient.setQueryData(['book-progress', bookId], {
        progress_percent: 0,
      });
    },
  }));
}

export async function resetAllReadingProgress() {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE('/v1/me/progress', {
    params: {
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error) {
    throw error;
  }
}

export function createResetAllReadingProgressMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: resetAllReadingProgress,
    onSuccess: () => {
      // Every book's progress is now 0. Drop the books list (so progress bars
      // and relevance ordering re-fetch server-side) and invalidate any cached
      // single-book progress entries.
      queryClient.invalidateQueries({ queryKey: booksQueryKey });
      queryClient.invalidateQueries({ queryKey: ['book-progress'] });
    },
  }));
}
