import { useParams } from '@solidjs/router';
import { createEffect, createMemo, createSignal, lazy, onCleanup, Show, Suspense } from 'solid-js';
import { ArrowLeft, Heart } from 'lucide-solid';
import {
  createBookFileTextQuery,
  createBookQuery,
  createReadingProgressQuery,
  createUpdateBookMutation,
  createUpdateReadingProgressMutation,
  getBookFileUrl,
} from '@/api/books';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import { useI18n } from '@/i18n/I18nProvider';
import type { ReadingProgressController } from '@/reader/ReadingProgress/types';
import styles from './ReaderPage.module.scss';

const Fb2Reader = lazy(() => import('@/components/common/Fb2Reader/Fb2Reader'));
const PdfReader = lazy(() => import('@/components/common/PdfReader/PdfReader'));

const progressSaveDelayMs = 1000;

function ReaderPage() {
  const { t } = useI18n();
  const params = useParams();
  const bookId = () => params.bookId ?? '';
  const bookQuery = createBookQuery(bookId);
  const progressQuery = createReadingProgressQuery(bookId);
  const fb2FileQuery = createBookFileTextQuery(bookId, () => bookQuery.data?.format === 'fb2');
  const updateBookMutation = createUpdateBookMutation();
  const updateProgressMutation = createUpdateReadingProgressMutation();
  const [readingProgress, setReadingProgress] = createSignal<ReadingProgressController>();
  let saveTimeout: number | undefined;
  let progressUnsubscribe: (() => void) | undefined;
  let activeBookId = bookId();
  let restoredBookId: string | undefined;

  const markProgressRestored = () => {
    restoredBookId = bookId();
  };

  const book = createMemo(() => bookQuery.data);
  const isFb2 = createMemo(() => book()?.format === 'fb2');
  const isPdf = createMemo(() => book()?.format === 'pdf');

  const clearScheduledProgressSave = () => {
    if (saveTimeout === undefined) {
      return;
    }

    window.clearTimeout(saveTimeout);
    saveTimeout = undefined;
  };

  const clearProgressSubscription = () => {
    progressUnsubscribe?.();
    progressUnsubscribe = undefined;
  };

  createEffect(() => {
    const currentBookId = bookId();

    if (currentBookId === activeBookId) {
      return;
    }

    clearScheduledProgressSave();
    clearProgressSubscription();
    readingProgress()?.reset();
    activeBookId = currentBookId;
    restoredBookId = undefined;
    setReadingProgress(undefined);
  });

  const savedProgressPercent = createMemo(() => {
    if (restoredBookId === bookId()) {
      return undefined;
    }

    return progressQuery.data?.progress_percent;
  });

  const toggleFavorite = () => {
    const currentBook = book();
    if (!currentBook) {
      return;
    }

    updateBookMutation.mutate({
      bookId: currentBook.id,
      patch: {
        favorite: !currentBook.favorite,
      },
      invalidateBooks: false,
    });
  };

  const chromeContent = () => (
    <div class={styles.chromeContent}>
      <Button
        href="/library"
        variant="ghost"
        size="sm"
        iconOnly
        iconStart={<ArrowLeft />}
        aria-label={t('library')}
      />

      <div class={styles.bookTitle}>
        <Show when={book()} fallback={<span>{t('loading')}</span>}>
          {(currentBook) => <strong>{currentBook().title}</strong>}
        </Show>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={book()?.favorite ? t('removeFromFavorites') : t('addToFavorites')}
        iconStart={<Heart />}
        classList={{ [styles.favoriteActive]: Boolean(book()?.favorite) }}
        onClick={toggleFavorite}
      />
    </div>
  );

  const scheduleProgressSave = () => {
    const progress = readingProgress();

    if (!progress?.isReady()) {
      return;
    }

    clearScheduledProgressSave();

    const targetBookId = bookId();

    saveTimeout = window.setTimeout(() => {
      saveTimeout = undefined;

      if (targetBookId !== bookId()) {
        return;
      }

      const nextProgress = progress.getProgress();

      if (updateProgressMutation.isPending) {
        scheduleProgressSave();
        return;
      }

      updateProgressMutation.mutate({
        bookId: targetBookId,
        progressPercent: nextProgress,
      });
    }, progressSaveDelayMs);
  };

  const handleReadingProgress = (progress: ReadingProgressController) => {
    clearProgressSubscription();
    setReadingProgress(progress);
  };

  createEffect(() => {
    const progress = readingProgress();

    if (!progress) {
      return;
    }

    const onScroll = () => {
      if (!progress.hasRestored() && progress.isReady() && window.scrollY > 80) {
        progress.markUserScrolled();
      }

      scheduleProgressSave();
    };

    progressUnsubscribe = progress.onProgressChange(() => {
      scheduleProgressSave();
    });

    window.addEventListener('scroll', onScroll, { passive: true });

    onCleanup(() => {
      window.removeEventListener('scroll', onScroll);
      clearProgressSubscription();
    });
  });

  onCleanup(() => {
    clearScheduledProgressSave();
    clearProgressSubscription();
  });

  return (
    <div class={styles.readerPage}>
      <Show when={bookQuery.isError}>
        <div class={styles.state}>{t('requestFailedTryAgain')}</div>
      </Show>

      <Show when={bookQuery.isLoading}>
        <LoadingScreen label={t('loading')} />
      </Show>

      <Show when={isFb2()}>
        <Show when={fb2FileQuery.data} fallback={<LoadingScreen label={t('loading')} />}>
          {(fb2) => (
            <Suspense fallback={<LoadingScreen label={t('loading')} />}>
              <Fb2Reader
                fb2={fb2()}
                class={styles.fb2Reader}
                headerContent={chromeContent()}
                onReadingProgress={handleReadingProgress}
                savedProgressPercent={savedProgressPercent()}
                onProgressRestored={markProgressRestored}
              />
            </Suspense>
          )}
        </Show>
      </Show>

      <Show when={isPdf()}>
        <Suspense fallback={<LoadingScreen label={t('loading')} />}>
          <PdfReader
            fileUrl={getBookFileUrl(bookId())}
            class={styles.pdfReader}
            headerContent={chromeContent()}
            onReadingProgress={handleReadingProgress}
            savedProgressPercent={savedProgressPercent()}
            onProgressRestored={markProgressRestored}
          />
        </Suspense>
      </Show>
    </div>
  );
}

export default ReaderPage;
