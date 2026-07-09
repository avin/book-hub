import { A } from '@solidjs/router';
import { ChevronDown, Heart } from 'lucide-solid';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';
import { type Book, getBookCoverUrl } from '@/api/books';
import Button from '@/components/common/Button/Button';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import BookActionsMenu from '../BookActionsMenu/BookActionsMenu';
import { useI18n } from '@/i18n/I18nProvider';
import BookCover from '../BookCover/BookCover';
import styles from './BookCard.module.scss';

function areTagsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function BookCard(props: {
  book: Accessor<Book>;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onResetProgress: (book: Book) => void;
}) {
  const { t } = useI18n();
  const bookId = createMemo(() => props.book().id);
  const title = createMemo(() => props.book().title);
  const favorite = createMemo(() => props.book().favorite);
  const format = createMemo(() => props.book().format);
  const progressPercent = createMemo(() => props.book().progress_percent);
  const [coverPreviewOpen, setCoverPreviewOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const tags = createMemo<Book['tags']>((previousTags) => {
    const nextTags = props.book().tags;

    return areTagsEqual(previousTags, nextTags) ? previousTags : nextTags;
  }, []);

  const showCover = () => {
    setMenuOpen(false);
    setCoverPreviewOpen(true);
  };

  const handleCoverContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    showCover();
  };

  return (
    <article class={styles.bookCard}>
      <A class={styles.bookMain} href={`/reader/${bookId()}`}>
        <span
          class={styles.coverLink}
          title={t('showFullCover')}
          onContextMenu={handleCoverContextMenu}
        >
          <BookCover bookId={bookId()} format={format()} version={props.book().updated_at} />
        </span>
        <div class={styles.bookContent}>
          <div class={styles.bookTitleRow}>
            <h2>{title()}</h2>
          </div>

          <Show when={tags().length > 0}>
            <div class={styles.cardTags}>
              <For each={tags()}>{(tag) => <span>{tag}</span>}</For>
            </div>
          </Show>
        </div>
      </A>

      <div class={styles.bookActions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={favorite() ? t('removeFromFavorites') : t('addToFavorites')}
          aria-pressed={favorite()}
          iconStart={<Heart />}
          classList={{ [styles.favoriteActive]: favorite() }}
          onClick={() => props.onFavoriteToggle(props.book())}
        />
        <Dropdown
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          placement="bottom-end"
          minWidth={220}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t('bookActions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen()}
              iconStart={<ChevronDown />}
              onClick={() => setMenuOpen(!menuOpen())}
            />
          }
        >
          <BookActionsMenu
            book={props.book}
            onFavoriteToggle={props.onFavoriteToggle}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
            onResetProgress={props.onResetProgress}
            onShowCover={showCover}
            onAction={() => setMenuOpen(false)}
          />
        </Dropdown>
      </div>

      <div class={styles.progress}>
        <span style={{ width: `${progressPercent()}%` }} />
      </div>

      <Show when={coverPreviewOpen()}>
        <div class={styles.coverPreviewBackdrop} onClick={() => setCoverPreviewOpen(false)}>
          <div class={styles.coverPreviewDialog}>
            <img src={getBookCoverUrl(bookId())} alt="" />
          </div>
        </div>
      </Show>
    </article>
  );
}

export default BookCard;
