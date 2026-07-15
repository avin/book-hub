export type {
  Book,
  BookListResponse,
  BookPatchRequest,
  BookQueryRequest,
  BookSort,
  ReadingProgress,
} from './books/types';

export { booksQueryKey, bookTagsQueryKey } from './books/queryKeys';

export type { BookCoverVariant } from './books/transport';
export {
  deleteBook,
  deleteBookCover,
  fetchBookFileBlob,
  fetchBookFileText,
  getBook,
  getBookCoverUrl,
  getBookDownloadName,
  getBookDownloadUrl,
  getBookFileUrl,
  getReadingProgress,
  listBookTags,
  queryBooks,
  resetAllReadingProgress,
  resetReadingProgress,
  updateBook,
  updateReadingProgress,
  uploadBook,
  uploadBookCover,
} from './books/transport';

export {
  createBookFileBlobQuery,
  createBookFileTextQuery,
  createBookQuery,
  createBookTagsQuery,
  createReadingProgressQuery,
} from './books/queries';

export {
  createDeleteBookCoverMutation,
  createDeleteBookMutation,
  createResetAllReadingProgressMutation,
  createResetReadingProgressMutation,
  createUpdateBookMutation,
  createUpdateReadingProgressMutation,
  createUploadBookCoverMutation,
  createUploadBookMutation,
} from './books/mutations';
