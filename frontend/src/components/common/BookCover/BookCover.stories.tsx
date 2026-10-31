import type { Book } from '@/api/books';
import BookCover from './BookCover';

export default { component: BookCover };

const sampleBook: Book = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Sample FB2 Book',
  tags: ['fiction'],
  favorite: false,
  format: 'fb2',
  size_bytes: 1240000,
  progress_percent: 42,
  created_at: '2026-07-05T12:00:00Z',
  last_opened_at: '2026-07-05T12:00:00Z',
  updated_at: '2026-07-05T12:00:00Z',
};

export const Default = () => (
  <div style={{ width: '92px', height: '120px' }}>
    <BookCover bookId={sampleBook.id} format={sampleBook.format} />
  </div>
);
