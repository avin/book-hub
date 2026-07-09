import { A } from '@solidjs/router';
import { Heart, MoreVertical } from 'lucide-solid';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import { type Book, getBookCoverUrl } from '@/api/books';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import { useI18n } from '@/i18n/I18nProvider';
import BookActionsMenu from '../BookActionsMenu/BookActionsMenu';
import BookCover from '../BookCover/BookCover';
import styles from './BookCardGrid.module.scss';

function BookCardGrid(props: {
  book: Accessor<Book>;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onResetProgress: (book: Book) => void;
}) {
  const { t } = useI18n();
  const [menuMode, setMenuMode] = createSignal<'button' | 'context' | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  const [coverPreviewOpen, setCoverPreviewOpen] = createSignal(false);
  const bookId = createMemo(() => props.book().id);
  const title = createMemo(() => props.book().title);
  const format = createMemo(() => props.book().format);
  const favorite = createMemo(() => props.book().favorite);
  const progressPercent = createMemo(() => props.book().progress_percent);

  const showCover = () => {
    setMenuMode(null);
    setCoverPreviewOpen(true);
  };

  return (
    <article
      class={styles.gridCard}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
        setMenuMode('context');
      }}
    >
      <A class={styles.coverLink} href={`/reader/${bookId()}`}>
        <BookCover
          bookId={bookId()}
          format={format()}
          version={props.book().updated_at}
          fallback={
            <div class={styles.titleFallback}>
              <span>{title()}</span>
            </div>
          }
        />
        <Show when={favorite()}>
          <span class={styles.favoriteBadge} aria-label={t('favorites')} title={t('favorites')}>
            <Heart />
          </span>
        </Show>
      </A>

      <Dropdown
        open={menuMode() === 'button'}
        onOpenChange={(open) => setMenuMode(open ? 'button' : null)}
        placement="bottom-end"
        minWidth={220}
        referenceStyle={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          width: '32px',
          height: '32px',
        }}
        trigger={
          <button
            type="button"
            class={styles.menuTrigger}
            aria-label={t('bookActions')}
            aria-haspopup="menu"
            aria-expanded={menuMode() === 'button'}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuMode(menuMode() === 'button' ? null : 'button');
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMenuMode('button');
              }
            }}
          >
            <MoreVertical />
          </button>
        }
      >
        <BookActionsMenu
          book={props.book}
          onFavoriteToggle={props.onFavoriteToggle}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onResetProgress={props.onResetProgress}
          onShowCover={showCover}
          onAction={() => setMenuMode(null)}
        />
      </Dropdown>

      <Dropdown
        open={menuMode() === 'context'}
        onOpenChange={(open) => setMenuMode(open ? 'context' : null)}
        placement="bottom-start"
        minWidth={220}
        referenceStyle={{
          position: 'fixed',
          left: `${contextMenuPosition().x}px`,
          top: `${contextMenuPosition().y}px`,
          width: '1px',
          height: '1px',
        }}
        trigger={
          <button type="button" class={styles.contextMenuAnchor} aria-hidden="true" tabindex="-1" />
        }
      >
        <BookActionsMenu
          book={props.book}
          onFavoriteToggle={props.onFavoriteToggle}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onResetProgress={props.onResetProgress}
          onShowCover={showCover}
          onAction={() => setMenuMode(null)}
        />
      </Dropdown>

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

export default BookCardGrid;
