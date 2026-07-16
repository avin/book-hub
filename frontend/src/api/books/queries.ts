import { createQuery } from '@tanstack/solid-query';
import {
  bookFileBlobQueryKey,
  bookFileTextQueryKey,
  bookProgressQueryKey,
  bookQueryKey,
  bookTagsQueryKey,
} from './queryKeys';
import {
  fetchBookFileBlob,
  fetchBookFileText,
  getBook,
  getReadingProgress,
  listBookTags,
} from './transport';

export function createBookTagsQuery() {
  return createQuery(() => ({
    queryKey: bookTagsQueryKey,
    queryFn: listBookTags,
  }));
}

export function createBookQuery(bookId: () => string) {
  return createQuery(() => ({
    queryKey: bookQueryKey(bookId()),
    queryFn: () => getBook(bookId()),
    enabled: Boolean(bookId()),
  }));
}

export function createBookFileTextQuery(bookId: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: bookFileTextQueryKey(bookId()),
    queryFn: () => fetchBookFileText(bookId()),
    enabled: enabled() && Boolean(bookId()),
  }));
}

export function createBookFileBlobQuery(bookId: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: bookFileBlobQueryKey(bookId()),
    queryFn: () => fetchBookFileBlob(bookId()),
    enabled: enabled() && Boolean(bookId()),
  }));
}

export function createReadingProgressQuery(bookId: () => string) {
  return createQuery(() => ({
    queryKey: bookProgressQueryKey(bookId()),
    queryFn: () => getReadingProgress(bookId()),
    enabled: Boolean(bookId()),
    retry: false,
  }));
}
