import type { Book } from '@/api/books';
import { I18nProvider } from '@/i18n/I18nProvider';
import BookInfo from './BookInfo';

export default { component: BookInfo };
const book: Book = {
  description:
    'Как создавать понятные интерфейсы и организовывать личную библиотеку.\nПрактические примеры и принципы проектирования.',
  id: 'sample',
  title: 'Архитектура удобных интерфейсов',
  tags: ['дизайн', 'интерфейсы'],
  favorite: false,
  format: 'epub',
  size_bytes: 2048,
  progress_percent: 0,
  created_at: '',
  updated_at: '',
  last_opened_at: '',
};
export const Default = () => (
  <I18nProvider>
    <BookInfo
      book={book}
      onShowCover={() => undefined}
      onTagSelect={() => undefined}
      onClose={() => undefined}
    />
  </I18nProvider>
);
export const Compact = () => (
  <I18nProvider>
    <BookInfo
      compact
      book={book}
      onShowCover={() => undefined}
      onTagSelect={() => undefined}
      onClose={() => undefined}
    />
  </I18nProvider>
);
