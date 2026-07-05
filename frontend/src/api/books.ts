import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { components } from "@/api/generated/schema";
import { apiClient, getCsrfToken } from "./client";
import { getApiBaseUrl } from "./baseUrl";

export type Book = components["schemas"]["Book"];
export type BookListResponse = components["schemas"]["BookListResponse"];
export type BookPatchRequest = components["schemas"]["BookPatchRequest"];
export type BookQueryRequest = components["schemas"]["BookQueryRequest"];
export type BookSort = components["schemas"]["BookSort"];
export type ReadingProgress = components["schemas"]["ReadingProgress"];

export const booksQueryKey = ["books"] as const;

export function getBookFileUrl(bookId: string) {
  return `${getApiBaseUrl()}/v1/books/${encodeURIComponent(bookId)}/file`;
}

export function getBookCoverUrl(bookId: string) {
  return `${getApiBaseUrl()}/v1/books/${encodeURIComponent(bookId)}/cover`;
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
  const { data, error } = await apiClient.POST("/v1/books/query", {
    body: query,
    params: {
      header: {
        "X-CSRF-Token": csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error("Books response is empty");
  }

  return data;
}

export function createBooksQuery(query: () => BookQueryRequest) {
  return createQuery(() => ({
    queryKey: [...booksQueryKey, query()],
    queryFn: () => queryBooks(query()),
  }));
}

export async function getBook(bookId: string) {
  const { data, error } = await apiClient.GET("/v1/books/{book_id}", {
    params: {
      path: {
        book_id: bookId,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error("Book response is empty");
  }

  return data;
}

export function createBookQuery(bookId: () => string) {
  return createQuery(() => ({
    queryKey: ["book", bookId()],
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

  formData.append("file", input.file);
  if (input.title?.trim()) {
    formData.append("title", input.title.trim());
  }
  for (const tag of input.tags) {
    formData.append("tags", tag);
  }
  formData.append("favorite", String(input.favorite));

  const response = await fetch(`${getApiBaseUrl()}/v1/books`, {
    method: "POST",
    credentials: "include",
    headers: {
      "X-CSRF-Token": csrfToken,
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
    },
  }));
}

export async function updateBook(bookId: string, patch: BookPatchRequest) {
  const csrfToken = await getCsrfToken();
  const { data, error } = await apiClient.PATCH("/v1/books/{book_id}", {
    body: patch,
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        "X-CSRF-Token": csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error("Book update response is empty");
  }

  return data;
}

export function createUpdateBookMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; patch: BookPatchRequest }) =>
      updateBook(input.bookId, input.patch),
    onSuccess: (book) => {
      queryClient.setQueryData(["book", book.id], book);
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export async function deleteBook(bookId: string) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE("/v1/books/{book_id}", {
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        "X-CSRF-Token": csrfToken,
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
    },
  }));
}

export async function uploadBookCover(bookId: string, file: File) {
  const csrfToken = await getCsrfToken();
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${getApiBaseUrl()}/v1/books/${encodeURIComponent(bookId)}/cover`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "X-CSRF-Token": csrfToken,
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
    mutationFn: (input: { bookId: string; file: File }) => uploadBookCover(input.bookId, input.file),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["book", input.bookId] });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export async function deleteBookCover(bookId: string) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE("/v1/books/{book_id}/cover", {
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        "X-CSRF-Token": csrfToken,
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
      queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export async function fetchBookFileText(bookId: string) {
  const response = await fetch(getBookFileUrl(bookId), {
    credentials: "include",
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return response.text();
}

export function createBookFileTextQuery(bookId: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: ["book-file-text", bookId()],
    queryFn: () => fetchBookFileText(bookId()),
    enabled: enabled() && Boolean(bookId()),
  }));
}

export async function getReadingProgress(bookId: string) {
  const { data, error } = await apiClient.GET("/v1/books/{book_id}/progress", {
    params: {
      path: {
        book_id: bookId,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error("Progress response is empty");
  }

  return data;
}

export function createReadingProgressQuery(bookId: () => string) {
  return createQuery(() => ({
    queryKey: ["book-progress", bookId()],
    queryFn: () => getReadingProgress(bookId()),
    enabled: Boolean(bookId()),
    retry: false,
  }));
}

export async function updateReadingProgress(bookId: string, progressPercent: number) {
  const csrfToken = await getCsrfToken();
  const { data, error } = await apiClient.PUT("/v1/books/{book_id}/progress", {
    body: {
      progress_percent: Math.min(100, Math.max(0, progressPercent)),
    },
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        "X-CSRF-Token": csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error("Progress update response is empty");
  }

  return data;
}

export function createUpdateReadingProgressMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (input: { bookId: string; progressPercent: number }) =>
      updateReadingProgress(input.bookId, input.progressPercent),
    onSuccess: (progress, input) => {
      queryClient.setQueryData(["book-progress", input.bookId], progress);
      void queryClient.invalidateQueries({ queryKey: ["book", input.bookId] });
      void queryClient.invalidateQueries({ queryKey: booksQueryKey });
    },
  }));
}

export async function resetReadingProgress(bookId: string) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.DELETE("/v1/books/{book_id}/progress", {
    params: {
      path: {
        book_id: bookId,
      },
      header: {
        "X-CSRF-Token": csrfToken,
      },
    },
  });

  if (error) {
    throw error;
  }
}
