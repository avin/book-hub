import { createMutation, useQueryClient } from '@tanstack/solid-query';
import { currentUserQueryKey } from '@/api/user';
import { updateBookProgressCache, updateCachedBookLists } from './cache';
import { bookProgressQueryKey, bookQueryKey, bookTagsQueryKey, booksQueryKey } from './queryKeys';
import {
  deleteBook,
  deleteBookCover,
  resetAllReadingProgress,
  resetReadingProgress,
  updateBook,
  updateReadingProgress,
  uploadBook,
  uploadBookCover,
} from './transport';
import type { BookPatchRequest } from './types';

export function createUploadBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: uploadBook,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
      void queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
    },
  }));
}

export function createUpdateBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; patch: BookPatchRequest; invalidateBooks?: boolean }) =>
      updateBook(input.bookId, input.patch),
    onSuccess: (book, input) => {
      queryClient.setQueryData(bookQueryKey(book.id), book);
      if (input.invalidateBooks === false) {
        updateCachedBookLists(queryClient, book);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
      void queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
    },
  }));
}

export function createDeleteBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: deleteBook,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
      void queryClient.invalidateQueries({ queryKey: bookTagsQueryKey });
    },
  }));
}

export function createUploadBookCoverMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; file: File }) =>
      uploadBookCover(input.bookId, input.file),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKey(input.bookId) });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export function createDeleteBookCoverMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: deleteBookCover,
    onSuccess: (_data, bookId) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKey(bookId) });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export function createUpdateReadingProgressMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; progressPercent: number }) =>
      updateReadingProgress(input.bookId, input.progressPercent),
    onSuccess: (progress, input) => {
      queryClient.setQueryData(bookProgressQueryKey(input.bookId), progress);
      updateBookProgressCache(queryClient, input.bookId, progress.progress_percent);
    },
  }));
}

export function createResetReadingProgressMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: resetReadingProgress,
    onSuccess: (_data, bookId) => {
      updateBookProgressCache(queryClient, bookId, 0, false);
      queryClient.setQueryData(bookProgressQueryKey(bookId), {
        progress_percent: 0,
      });
    },
  }));
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
