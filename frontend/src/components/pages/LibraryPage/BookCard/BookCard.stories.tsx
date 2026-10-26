import type { Book } from '@/api/books';
import { I18nProvider } from '@/i18n/I18nProvider';
import BookCard from './BookCard';

export default { component: BookCard };

const sampleBook: Book = {
  id: '00000000-0000-4000-8000-000000000002',
  title: 'The Architecture of Reading Systems',
  description:
    'A practical guide to building reading applications and organizing digital libraries.',
  tags: ['architecture', 'solidjs', 'reader'],
  favorite: true,
  format: 'fb2',
  size_bytes: 2480000,
  progress_percent: 67,
  created_at: '2026-07-05T12:00:00Z',
  last_opened_at: '2026-07-05T12:00:00Z',
  updated_at: '2026-07-05T12:00:00Z',
};

export const Default = () => (
  <I18nProvider>
    <div style={{ width: '620px' }}>
      <BookCard
        book={() => sampleBook}
        onFavoriteToggle={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onResetProgress={() => undefined}
      />
    </div>
  </I18nProvider>
);
