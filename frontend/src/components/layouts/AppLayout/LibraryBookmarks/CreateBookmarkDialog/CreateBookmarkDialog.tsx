import { createMemo, createSignal, Show } from 'solid-js';
import type { LibraryBookmark } from '@/api/libraryBookmarks';
import { createBookTagsQuery, type BookSearchField } from '@/api/books';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import SearchFieldSelect from '@/components/common/SearchFieldSelect/SearchFieldSelect';
import TagsSelect from '@/components/common/TagsSelect/TagsSelect';
import { mergeTagOptions } from '@/components/common/TagsSelect/tagUtils';
import TextInput from '@/components/common/TextInput/TextInput';
import { getLastLibraryListState } from '@/components/pages/LibraryPage/libraryListState';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './CreateBookmarkDialog.module.scss';

function createBookmarkId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function CreateBookmarkDialog(props: {
  saving: boolean;
  error: boolean;
  onSave: (bookmark: LibraryBookmark) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const initial = getLastLibraryListState();
  const [name, setName] = createSignal(t('bookmark'));
  const [search, setSearch] = createSignal(initial.search);
  const [searchField, setSearchField] = createSignal<BookSearchField>(initial.searchField);
  const [tags, setTags] = createSignal([...initial.tags]);
  const [invalid, setInvalid] = createSignal(false);
  const tagQuery = createBookTagsQuery();
  const options = createMemo(() => mergeTagOptions(tagQuery.data?.items ?? [], tags()));
  return (
    <ModalDialog
      ariaLabel={t('createBookmark')}
      overlayClass={styles.overlay}
      contentClass={styles.dialog}
      onClose={() => {
        if (!props.saving) props.onClose();
      }}
    >
      <h2>{t('createBookmark')}</h2>
      <form
        class={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name().trim();
          if (!trimmed || trimmed.length > 100) {
            setInvalid(true);
            return;
          }
          if (!props.saving)
            props.onSave({
              id: createBookmarkId(),
              name: trimmed,
              search: search(),
              searchField: searchField(),
              tags: [...tags()],
            });
        }}
      >
        <InputContainer
          label={t('title')}
          error={invalid() ? t('nameUpTo100Characters') : undefined}
        >
          <TextInput
            aria-label={t('title')}
            value={name()}
            maxLength={100}
            invalid={invalid()}
            onInput={(event) => {
              setName(event.currentTarget.value);
              setInvalid(false);
            }}
          />
        </InputContainer>
        <InputContainer label={t('searchBooks')}>
          <div class={styles.search}>
            <SearchFieldSelect value={searchField()} onChange={setSearchField} />
            <TextInput
              aria-label={t('searchBooks')}
              value={search()}
              placeholder={t(searchField() === 'description' ? 'findByDescription' : 'findByTitle')}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
          </div>
        </InputContainer>
        <InputContainer label={t('tags')}>
          <TagsSelect
            value={tags()}
            options={options()}
            onChange={setTags}
            placeholder={t('findByTag')}
          />
        </InputContainer>
        <Show when={props.error}>
          <p role="alert">{t('requestFailedTryAgain')}</p>
        </Show>
        <div class={styles.actions}>
          <Button type="button" variant="ghost" disabled={props.saving} onClick={props.onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" loading={props.saving}>
            {t('createBookmark')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
export default CreateBookmarkDialog;
