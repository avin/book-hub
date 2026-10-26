import { A } from '@solidjs/router';
import { Heart, Info, MoreVertical } from 'lucide-solid';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import { type Book, getBookCoverUrl } from '@/api/books';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import { useI18n } from '@/i18n/I18nProvider';
import BookActionsMenu from '../BookActionsMenu/BookActionsMenu';
import BookCover from '../BookCover/BookCover';
import BookInfo from '../BookInfo/BookInfo';
import styles from './BookCardGrid.module.scss';

function BookCardGrid(props: {
  book: Accessor<Book>;
  onTagSelect: (tag: string) => void;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onResetProgress: (book: Book) => void;
}) {
  const { t } = useI18n();
  const [menuMode, setMenuMode] = createSignal<'button' | 'context' | 'info' | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  const [infoOpen, setInfoOpen] = createSignal(false);
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
          onShowInfo={() => setInfoOpen(true)}
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
          onShowInfo={() => setInfoOpen(true)}
          onShowCover={showCover}
          onAction={() => setMenuMode(null)}
        />
      </Dropdown>

      <Dropdown
        open={menuMode() === 'info'}
        maxHeight="min(480px, calc(100dvh - 24px))"
        onOpenChange={(open) => setMenuMode(open ? 'info' : null)}
        placement="bottom-start"
        referenceStyle={{
          position: 'absolute',
          right: '8px',
          bottom: '11px',
          width: '32px',
          height: '32px',
        }}
        trigger={
          <button
            type="button"
            class={styles.menuTrigger}
            aria-label={t('bookInformation')}
            title={t('bookInformation')}
            aria-haspopup="dialog"
            aria-expanded={menuMode() === 'info'}
            onClick={() => setMenuMode(menuMode() === 'info' ? null : 'info')}
          >
            <Info />
          </button>
        }
      >
        <BookInfo
          compact
          book={props.book()}
          onShowCover={showCover}
          onTagSelect={props.onTagSelect}
          onClose={() => setMenuMode(null)}
        />
      </Dropdown>

      <div class={styles.progress}>
        <span style={{ width: `${progressPercent()}%` }} />
      </div>

      <Show when={infoOpen() && !coverPreviewOpen()}>
        <BookInfo
          book={props.book()}
          onShowCover={showCover}
          onTagSelect={props.onTagSelect}
          onClose={() => setInfoOpen(false)}
        />
      </Show>

      <Show when={coverPreviewOpen()}>
        <ModalDialog
          overlayClass={styles.coverPreviewBackdrop}
          contentClass={styles.coverPreviewDialog}
          ariaLabel={t('showFullCoverMenu')}
          onClose={() => setCoverPreviewOpen(false)}
        >
          <img src={getBookCoverUrl(bookId())} alt="" />
        </ModalDialog>
      </Show>
    </article>
  );
}

export default BookCardGrid;
