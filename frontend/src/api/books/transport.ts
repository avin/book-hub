import { readFb2BlobText } from '@/bookFormats/fb2TextDecoder';
import { getApiBaseUrl } from '../baseUrl';
import { apiClient, getCsrfToken } from '../client';
import type { Book, BookPatchRequest, BookQueryRequest } from './types';

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

export async function uploadBook(input: {
  file: File;
  title?: string;
  description?: string;
  tags: string[];
  favorite: boolean;
}) {
  const csrfToken = await getCsrfToken();
  const formData = new FormData();

  formData.append('file', input.file);
  if (input.title?.trim()) {
    formData.append('title', input.title.trim());
  }
  formData.append('description', input.description?.trim() ?? '');
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
