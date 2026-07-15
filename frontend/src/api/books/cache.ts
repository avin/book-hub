import type { InfiniteData, QueryClient } from '@tanstack/solid-query';
import { bookQueryKey, booksQueryKey } from './queryKeys';
import type { Book, BookListResponse, BookQueryRequest } from './types';

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

export function updateCachedBookLists(queryClient: QueryClient, book: Book) {
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

export function updateBookProgressCache(
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

  queryClient.setQueryData<Book>(bookQueryKey(bookId), (book) => (book ? updateBook(book) : book));

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
