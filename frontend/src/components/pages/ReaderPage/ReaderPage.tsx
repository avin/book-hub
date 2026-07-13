import { useParams } from '@solidjs/router';
import { createEffect, createMemo, createSignal, lazy, onCleanup, Show, Suspense } from 'solid-js';
import { ArrowLeft, Heart } from 'lucide-solid';
import {
  createBookFileTextQuery,
  createBookFileBlobQuery,
  createBookQuery,
  createReadingProgressQuery,
  createUpdateBookMutation,
  createUpdateReadingProgressMutation,
  getBookFileUrl,
} from '@/api/books';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ReaderPage.module.scss';

const Fb2Reader = lazy(() => import('@/components/common/Fb2Reader/Fb2Reader'));
const EpubReader = lazy(() => import('@/components/common/EpubReader/EpubReader'));
const PdfReader = lazy(() => import('@/components/common/PdfReader/PdfReader'));
const DjvuReader = lazy(() => import('@/components/common/DjvuReader/DjvuReader'));

const progressSaveDelayMs = 1000;

function scrollProgressPercent() {
  const root = document.documentElement;
  const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);

  if (maxScroll === 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100));
}

function restoreScrollProgress(progressPercent: number) {
  const root = document.documentElement;
  const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);

  window.scrollTo({ top: (maxScroll * progressPercent) / 100 });
}

function ReaderPage() {
  const { t } = useI18n();
  const params = useParams();
  const bookId = () => params.bookId ?? '';
  const bookQuery = createBookQuery(bookId);
  const progressQuery = createReadingProgressQuery(bookId);
  const fb2FileQuery = createBookFileTextQuery(bookId, () => bookQuery.data?.format === 'fb2');
  const epubFileQuery = createBookFileBlobQuery(bookId, () => bookQuery.data?.format === 'epub');
  const updateBookMutation = createUpdateBookMutation();
  const updateProgressMutation = createUpdateReadingProgressMutation();
  const [pdfReady, setPdfReady] = createSignal(false);
  const [djvuReady, setDjvuReady] = createSignal(false);
  const [epubReady, setEpubReady] = createSignal(false);
  let saveTimeout: number | undefined;
  let restoreTimeoutIds: number[] = [];
  let activeBookId = bookId();
  let restoredBookId: string | undefined;

  const book = createMemo(() => bookQuery.data);
  const isFb2 = createMemo(() => book()?.format === 'fb2');
  const isPdf = createMemo(() => book()?.format === 'pdf');
  const isDjvu = createMemo(() => book()?.format === 'djvu');
  const isEpub = createMemo(() => book()?.format === 'epub');
  const canTrackProgress = createMemo(
    () =>
      isFb2() || (isEpub() && epubReady()) || (isPdf() && pdfReady()) || (isDjvu() && djvuReady()),
  );
  const canRestoreProgress = createMemo(
    () =>
      (isFb2() && fb2FileQuery.data) ||
      (isEpub() && epubReady()) ||
      (isPdf() && pdfReady()) ||
      (isDjvu() && djvuReady()),
  );

  const clearScheduledProgressSave = () => {
    if (saveTimeout === undefined) {
      return;
    }

    window.clearTimeout(saveTimeout);
    saveTimeout = undefined;
  };

  const clearScheduledProgressRestore = () => {
    for (const timeoutId of restoreTimeoutIds) {
      window.clearTimeout(timeoutId);
    }

    restoreTimeoutIds = [];
  };

  createEffect(() => {
    const currentBookId = bookId();

    if (currentBookId === activeBookId) {
      return;
    }

    clearScheduledProgressSave();
    clearScheduledProgressRestore();
    activeBookId = currentBookId;
    restoredBookId = undefined;
    setPdfReady(false);
    setDjvuReady(false);
    setEpubReady(false);
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
    if (!canTrackProgress()) {
      return;
    }

    clearScheduledProgressSave();

    const targetBookId = bookId();

    saveTimeout = window.setTimeout(() => {
      saveTimeout = undefined;

      if (targetBookId !== bookId()) {
        return;
      }

      const nextProgress = scrollProgressPercent();

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

  createEffect(() => {
    if (!canTrackProgress()) {
      return;
    }

    const onScroll = () => scheduleProgressSave();
    window.addEventListener('scroll', onScroll, { passive: true });

    onCleanup(() => {
      window.removeEventListener('scroll', onScroll);
    });
  });

  createEffect(() => {
    const currentBookId = bookId();
    const progress = progressQuery.data;

    if (restoredBookId === currentBookId || !canRestoreProgress() || !progress) {
      return;
    }

    clearScheduledProgressRestore();
    restoredBookId = currentBookId;
    const restoreDelayMs = isPdf() || isDjvu() ? 80 : 350;
    const confirmRestoreDelayMs = isPdf() || isDjvu() ? 260 : 900;
    const progressPercent = progress.progress_percent;

    restoreTimeoutIds = [
      window.setTimeout(() => {
        if (window.scrollY <= 80) restoreScrollProgress(progressPercent);
      }, restoreDelayMs),
      window.setTimeout(() => {
        if (window.scrollY <= 80) restoreScrollProgress(progressPercent);
      }, confirmRestoreDelayMs),
    ];
  });

  onCleanup(() => {
    clearScheduledProgressSave();
    clearScheduledProgressRestore();
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
                historyId={bookId()}
                class={styles.fb2Reader}
                headerContent={chromeContent()}
              />
            </Suspense>
          )}
        </Show>
      </Show>

      <Show when={isPdf()}>
        <Suspense fallback={<LoadingScreen label={t('loading')} />}>
          <PdfReader
            bookId={bookId()}
            fileUrl={getBookFileUrl(bookId())}
            class={styles.pdfReader}
            headerContent={chromeContent()}
            onReady={() => setPdfReady(true)}
          />
        </Suspense>
      </Show>

      <Show when={isDjvu()}>
        <Suspense fallback={<LoadingScreen label={t('loading')} />}>
          <DjvuReader
            bookId={bookId()}
            fileUrl={getBookFileUrl(bookId())}
            class={styles.pdfReader}
            headerContent={chromeContent()}
            onReady={() => setDjvuReady(true)}
          />
        </Suspense>
      </Show>

      <Show when={isEpub()}>
        <Show when={epubFileQuery.data} fallback={<LoadingScreen label={t('loading')} />}>
          {(epub) => (
            <Suspense fallback={<LoadingScreen label={t('loading')} />}>
              <EpubReader
                epub={epub()}
                historyId={bookId()}
                class={styles.fb2Reader}
                headerContent={chromeContent()}
                onReady={() => setEpubReady(true)}
              />
            </Suspense>
          )}
        </Show>
      </Show>
    </div>
  );
}

export default ReaderPage;
