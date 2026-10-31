import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  type Book,
  createDeleteBookMutation,
  createResetReadingProgressMutation,
} from '@/api/books';
import Button from '@/components/common/Button/Button';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './BookActionDialog.module.scss';

function BookActionDialog(props: {
  book: Book;
  action: 'delete' | 'resetProgress';
  onClose: () => void;
}) {
  const { t } = useI18n();
  const deleteMutation = createDeleteBookMutation();
  const resetMutation = createResetReadingProgressMutation();
  const mutation = () => (props.action === 'delete' ? deleteMutation : resetMutation);
  const title = () => {
    const bookTitle = props.book.title;
    return t(props.action === 'delete' ? 'deleteBook' : 'resetReadingProgressForBook').replace(
      '{title}',
      () => bookTitle,
    );
  };
  const close = () => {
    if (!mutation().isPending) props.onClose();
  };

  return (
    <Portal>
      <ModalDialog
        ariaLabel={title()}
        overlayClass={styles.overlay}
        contentClass={styles.dialog}
        onClose={close}
      >
        <h2>{title()}</h2>
        <Show when={mutation().isError}>
          <p role="alert">{t('requestFailedTryAgain')}</p>
        </Show>
        <div class={styles.actions}>
          <Button type="button" variant="ghost" disabled={mutation().isPending} onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={mutation().isPending}
            onClick={() => {
              if (!mutation().isPending) {
                mutation().mutate(props.book.id, { onSuccess: props.onClose });
              }
            }}
          >
            {t(props.action === 'delete' ? 'delete' : 'resetReadingProgress')}
          </Button>
        </div>
      </ModalDialog>
    </Portal>
  );
}

export default BookActionDialog;
