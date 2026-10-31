import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { Book } from '@/api/books';
import { I18nProvider } from '@/i18n/I18nProvider';
import BookActionDialog from './BookActionDialog';

export default { component: BookActionDialog };

const book: Book = {
  id: '00000000-0000-4000-8000-000000000003',
  title: 'Go на практике',
  tags: [],
  favorite: false,
  format: 'pdf',
  size_bytes: 980000,
  progress_percent: 42,
  created_at: '2026-07-05T12:00:00Z',
  last_opened_at: '2026-07-05T12:00:00Z',
  updated_at: '2026-07-05T12:00:00Z',
};

export const Default = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>
      <BookActionDialog book={book} action="delete" onClose={() => undefined} />
    </I18nProvider>
  </QueryClientProvider>
);

export const ResetProgress = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>
      <BookActionDialog book={book} action="resetProgress" onClose={() => undefined} />
    </I18nProvider>
  </QueryClientProvider>
);
