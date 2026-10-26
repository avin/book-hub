import { createSignal } from 'solid-js';
import type { BookSearchField } from '@/api/books';
import { I18nProvider } from '@/i18n/I18nProvider';
import SearchFieldSelect from './SearchFieldSelect';

export default { component: SearchFieldSelect };

export const Default = () => {
  const [value, setValue] = createSignal<BookSearchField>('title');
  return (
    <I18nProvider>
      <SearchFieldSelect value={value()} onChange={setValue} />
    </I18nProvider>
  );
};
