import { X } from 'lucide-solid';
import { For, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { Book } from '@/api/books';
import Button from '@/components/common/Button/Button';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import { useI18n } from '@/i18n/I18nProvider';
import BookCover from '../BookCover/BookCover';
import styles from './BookInfo.module.scss';

function BookInfo(props: {
  book: Book;
  compact?: boolean;
  onShowCover: () => void;
  onTagSelect: (tag: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  let content: HTMLDivElement | undefined;

  onMount(() => {
    if (!props.compact) return;
    const trigger = document.activeElement;
    content?.querySelector('button')?.focus({ preventScroll: true });
    onCleanup(() => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    });
  });

  const body = (
    <div
      ref={content}
      class={styles.bookInfo}
      classList={{ [styles.compact]: props.compact }}
      onKeyDown={(event) => {
        if (props.compact || event.key !== 'Tab') return;
        const buttons = content?.querySelectorAll<HTMLButtonElement>('button');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        class={styles.close}
        aria-label={t('close')}
        iconStart={<X />}
        onClick={props.onClose}
      />
      <Show when={!props.compact}>
        <button
          type="button"
          class={styles.cover}
          aria-label={t('showFullCoverMenu')}
          title={t('showFullCoverMenu')}
          onClick={() => props.onShowCover()}
        >
          <BookCover
            bookId={props.book.id}
            format={props.book.format}
            version={props.book.updated_at}
          />
        </button>
      </Show>
      <div class={styles.details}>
        <h2>{props.book.title}</h2>
        <Show when={props.book.description?.trim()}>
          {(description) => <p class={styles.description}>{description()}</p>}
        </Show>
        <Show when={props.book.tags.length} fallback={<p class={styles.hint}>{t('noTags')}</p>}>
          <div class={styles.tags}>
            <For each={props.book.tags}>
              {(tag) => (
                <Button
                  type="button"
                  variant="ghost"
                  class={styles.tag}
                  onClick={() => {
                    props.onClose();
                    props.onTagSelect(tag);
                  }}
                >
                  <span class={styles.tagText}>{tag}</span>
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );

  return (
    <Show
      when={!props.compact}
      fallback={
        <section role="dialog" aria-label={t('bookInformation')}>
          {body}
        </section>
      }
    >
      <Portal>
        <ModalDialog
          overlayClass={styles.backdrop}
          contentClass={styles.dialog}
          ariaLabel={t('bookInformation')}
          onClose={props.onClose}
        >
          {body}
        </ModalDialog>
      </Portal>
    </Show>
  );
}

export default BookInfo;
