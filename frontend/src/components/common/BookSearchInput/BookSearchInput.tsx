import { X } from 'lucide-solid';
import { Show } from 'solid-js';
import type { BookSearchField } from '@/api/books';
import SearchFieldSelect from '@/components/common/SearchFieldSelect/SearchFieldSelect';
import TextInput from '@/components/common/TextInput/TextInput';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './BookSearchInput.module.scss';

function BookSearchInput(props: {
  value: string;
  onChange: (value: string) => void;
  searchField: BookSearchField;
  onSearchFieldChange: (field: BookSearchField) => void;
  onClear?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div class={styles.searchField} classList={{ [styles.searchFieldActive]: props.value !== '' }}>
      <SearchFieldSelect value={props.searchField} onChange={props.onSearchFieldChange} />
      <TextInput
        class={styles.searchInput}
        aria-label={t('searchBooks')}
        value={props.value}
        placeholder={t(props.searchField === 'description' ? 'findByDescription' : 'findByTitle')}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
      <Show when={props.value !== ''}>
        <button
          type="button"
          class={styles.searchClear}
          aria-label={t('clearSearch')}
          title={t('clearSearch')}
          onClick={() => {
            props.onChange('');
            props.onClear?.();
          }}
        >
          <X />
        </button>
      </Show>
    </div>
  );
}

export default BookSearchInput;
