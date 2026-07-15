export const booksQueryKey = ['books'] as const;
export const bookTagsQueryKey = ['book-tags'] as const;

export function bookQueryKey(bookId: string) {
  return ['book', bookId] as const;
}

export function bookFileTextQueryKey(bookId: string) {
  return ['book-file-text', bookId] as const;
}

export function bookFileBlobQueryKey(bookId: string) {
  return ['book-file-blob', bookId] as const;
}

export function bookProgressQueryKey(bookId: string) {
  return ['book-progress', bookId] as const;
}
