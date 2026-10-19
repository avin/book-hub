import { useParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { ArrowLeft, Heart } from 'lucide-solid';
import { loadModule } from '@/loadModule';
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

const Fb2Reader = lazy(() => loadModule(() => import('@/components/common/Fb2Reader/Fb2Reader')));
const EpubReader = lazy(() =>
  loadModule(() => import('@/components/common/EpubReader/EpubReader')),
);
const PdfReader = lazy(() => loadModule(() => import('@/components/common/PdfReader/PdfReader')));
const DjvuReader = lazy(() =>
  loadModule(() => import('@/components/common/DjvuReader/DjvuReader')),
);

const progressSaveDelayMs = 1000;
const restoreStableFrames = 6;
const restoreMaxWaitMs = 1500;
const restoreConfirmDelayMs = 600;

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
  const [restoreState, setRestoreState] = createSignal<'pending' | 'restoring' | 'done'>('pending');
  let saveTimeout: number | undefined;
  let restoreTimeoutIds: number[] = [];
  let restoreFrame: number | undefined;
  let restoreCleanup: (() => void) | undefined;
  let activeBookId = bookId();

  const book = createMemo(() => bookQuery.data);
  const isFb2 = createMemo(() => book()?.format === 'fb2');
  const isPdf = createMemo(() => book()?.format === 'pdf');
  const isDjvu = createMemo(() => book()?.format === 'djvu');
  const isEpub = createMemo(() => book()?.format === 'epub');
  const canTrackProgress = createMemo(
    () =>
      restoreState() === 'done' &&
      (isFb2() ||
        (isEpub() && epubReady()) ||
        (isPdf() && pdfReady()) ||
        (isDjvu() && djvuReady())),
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

    if (restoreFrame !== undefined) {
      cancelAnimationFrame(restoreFrame);
      restoreFrame = undefined;
    }

    restoreCleanup?.();
    restoreCleanup = undefined;
  };

  createEffect(() => {
    const currentBookId = bookId();

    if (currentBookId === activeBookId) {
      return;
    }

    clearScheduledProgressSave();
    clearScheduledProgressRestore();
    activeBookId = currentBookId;
    setRestoreState('pending');
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
    const progress = progressQuery.data;

    if (restoreState() !== 'pending' || !canRestoreProgress()) {
      return;
    }

    if (!progress) {
      if (progressQuery.isError) {
        setRestoreState('done');
      }

      return;
    }

    if (progress.progress_percent <= 0) {
      setRestoreState('done');
      return;
    }

    setRestoreState('restoring');
    untrack(() => restoreProgressWhenLayoutSettles(progress.progress_percent));
  });

  const restoreProgressWhenLayoutSettles = (progressPercent: number) => {
    const deadline = performance.now() + restoreMaxWaitMs;
    let lastScrollHeight = -1;
    let stableFrames = 0;

    const finish = () => {
      restoreCleanup = undefined;
      setRestoreState('done');
      window.removeEventListener('wheel', cancelOnUserInput);
      window.removeEventListener('touchstart', cancelOnUserInput);
      window.removeEventListener('keydown', cancelOnUserInput);
    };
    const cancelOnUserInput = () => {
      clearScheduledProgressRestore();
      finish();
    };
    const step = () => {
      const scrollHeight = document.documentElement.scrollHeight;

      stableFrames = scrollHeight === lastScrollHeight ? stableFrames + 1 : 0;
      lastScrollHeight = scrollHeight;

      if (stableFrames < restoreStableFrames && performance.now() < deadline) {
        restoreFrame = requestAnimationFrame(step);
        return;
      }

      restoreFrame = undefined;
      restoreScrollProgress(progressPercent);
      finish();
      // Читалки могут ещё раз пересчитать раскладку после загрузки шрифтов
      // и сбросить позицию в начало; повторяем восстановление в этом случае.
      restoreTimeoutIds = [
        window.setTimeout(() => {
          if (window.scrollY <= 80) restoreScrollProgress(progressPercent);
        }, restoreConfirmDelayMs),
      ];
    };

    window.addEventListener('wheel', cancelOnUserInput, { passive: true });
    window.addEventListener('touchstart', cancelOnUserInput, { passive: true });
    window.addEventListener('keydown', cancelOnUserInput);
    restoreCleanup = finish;
    restoreFrame = requestAnimationFrame(step);
  };

  onCleanup(() => {
    clearScheduledProgressSave();
    clearScheduledProgressRestore();
  });

  const loadError = createMemo(() => {
    if (bookQuery.isError) {
      return bookQuery.error;
    }

    if (isFb2() && fb2FileQuery.isError) {
      return fb2FileQuery.error;
    }

    return isEpub() && epubFileQuery.isError ? epubFileQuery.error : undefined;
  });
  const showLoadingOverlay = () =>
    bookQuery.isLoading ||
    restoreState() === 'restoring' ||
    (restoreState() === 'pending' && Boolean(canRestoreProgress()) && progressQuery.isLoading);
  const loadErrorIsNotFound = () =>
    (loadError() as { code?: unknown } | undefined)?.code === 'not_found';

  return (
    <div class={styles.readerPage}>
      <Show when={loadError()}>
        <div class={styles.state}>
          <p>{loadErrorIsNotFound() ? t('bookNotFound') : t('requestFailedTryAgain')}</p>
          <div class={styles.stateActions}>
            <Show when={!loadErrorIsNotFound()}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void bookQuery.refetch();
                  if (isFb2()) void fb2FileQuery.refetch();
                  if (isEpub()) void epubFileQuery.refetch();
                }}
              >
                {t('tryAgain')}
              </Button>
            </Show>
            <Button href="/library">{t('backToLibrary')}</Button>
          </div>
        </div>
      </Show>

      <Show when={showLoadingOverlay()}>
        <LoadingScreen class={styles.loadingOverlay} label={t('loading')} />
      </Show>

      <Show when={isFb2() && !fb2FileQuery.isError}>
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

      <Show when={isEpub() && !epubFileQuery.isError}>
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
