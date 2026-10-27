import { createSignal } from 'solid-js';
import type { BookSearchField } from '@/api/books';
import { I18nProvider } from '@/i18n/I18nProvider';
import BookSearchInput from './BookSearchInput';

export default { component: BookSearchInput };

export const Default = () => {
  const [value, setValue] = createSignal('');
  const [field, setField] = createSignal<BookSearchField>('title');
  return (
    <I18nProvider>
      <BookSearchInput
        value={value()}
        onChange={setValue}
        searchField={field()}
        onSearchFieldChange={setField}
      />
    </I18nProvider>
  );
};
