import { A } from '@solidjs/router';
import { ChevronDown, Heart } from 'lucide-solid';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';
import { type Book, getBookCoverUrl } from '@/api/books';
import Button from '@/components/common/Button/Button';
import ContextMenu from '@/components/common/ContextMenu/ContextMenu';
import { createContextMenu } from '@/components/common/ContextMenu/createContextMenu';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import BookActionsMenu from '../BookActionsMenu/BookActionsMenu';
import { useI18n } from '@/i18n/I18nProvider';
import BookCover from '@/components/common/BookCover/BookCover';
import BookInfo from '@/components/common/BookInfo/BookInfo';
import BookDescription from './BookDescription/BookDescription';
import styles from './BookCard.module.scss';

function areTagsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function BookCard(props: {
  book: Accessor<Book>;
  onTagSelect: (tag: string) => void;
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
  const [infoOpen, setInfoOpen] = createSignal(false);
  const [coverPreviewOpen, setCoverPreviewOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  let menuTriggerRef: HTMLButtonElement | undefined;
  const confirmAction = (action: (book: Book) => void) => {
    menuTriggerRef?.focus({ preventScroll: true });
    action(props.book());
  };
  const contextMenu = createContextMenu(() => setMenuOpen(false));
  const tags = createMemo<Book['tags']>((previousTags) => {
    const nextTags = props.book().tags;

    return areTagsEqual(previousTags, nextTags) ? previousTags : nextTags;
  }, []);

  const showCover = () => {
    setMenuOpen(false);
    contextMenu.close();
    setCoverPreviewOpen(true);
  };

  return (
    <article class={styles.bookCard}>
      <div class={styles.bookMain}>
        <div class={styles.coverColumn}>
          <A
            class={styles.coverLink}
            href={`/reader/${bookId()}`}
            aria-label={title()}
            title={title()}
            onContextMenu={contextMenu.handleContextMenu}
          >
            <BookCover bookId={bookId()} format={format()} version={props.book().updated_at} />
          </A>
        </div>
        <div class={styles.bookContent}>
          <div class={styles.bookTitleRow}>
            <h2>
              <A class={styles.titleLink} href={`/reader/${bookId()}`}>
                {title()}
              </A>
            </h2>
          </div>

          <Show when={props.book().description?.trim()}>
            {(description) => <BookDescription text={description()} />}
          </Show>

          <Show when={tags().length > 0}>
            <div class={styles.cardTags}>
              <For each={tags()}>
                {(tag) => (
                  <Button
                    type="button"
                    variant="ghost"
                    class={styles.cardTag}
                    onClick={() => props.onTagSelect(tag)}
                  >
                    {tag}
                  </Button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

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
              ref={menuTriggerRef}
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
            onDelete={() => confirmAction(props.onDelete)}
            onResetProgress={() => confirmAction(props.onResetProgress)}
            onShowInfo={() => setInfoOpen(true)}
            onShowCover={showCover}
            onAction={() => setMenuOpen(false)}
          />
        </Dropdown>
      </div>

      <ContextMenu controller={contextMenu} minWidth={220}>
        <BookActionsMenu
          book={props.book}
          onFavoriteToggle={props.onFavoriteToggle}
          onEdit={props.onEdit}
          onDelete={() => confirmAction(props.onDelete)}
          onResetProgress={() => confirmAction(props.onResetProgress)}
          onShowInfo={() => setInfoOpen(true)}
          onShowCover={showCover}
          onAction={contextMenu.close}
        />
      </ContextMenu>

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

export default BookCard;
