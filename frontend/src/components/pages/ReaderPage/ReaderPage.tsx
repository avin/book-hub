import { A, useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, lazy, onCleanup, Show, Suspense } from "solid-js";
import { ArrowLeft, Heart } from "lucide-solid";
import {
  createBookFileTextQuery,
  createBookQuery,
  createReadingProgressQuery,
  createUpdateBookMutation,
  createUpdateReadingProgressMutation,
  getBookFileUrl,
} from "@/api/books";
import Button from "@/components/common/Button/Button";
import LoadingScreen from "@/components/common/LoadingScreen/LoadingScreen";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./ReaderPage.module.scss";

const Fb2Reader = lazy(() => import("@/components/common/Fb2Reader/Fb2Reader"));
const PdfReader = lazy(() => import("@/components/common/PdfReader/PdfReader"));

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
  const bookId = () => params.bookId ?? "";
  const bookQuery = createBookQuery(bookId);
  const progressQuery = createReadingProgressQuery(bookId);
  const fb2FileQuery = createBookFileTextQuery(bookId, () => bookQuery.data?.format === "fb2");
  const updateBookMutation = createUpdateBookMutation();
  const updateProgressMutation = createUpdateReadingProgressMutation();
  const [pdfReady, setPdfReady] = createSignal(false);
  let saveTimeout: number | undefined;
  let restoreTimeoutIds: number[] = [];
  let activeBookId = bookId();
  let restoredBookId: string | undefined;
  let lastSavedProgress = progressQuery.data?.progress_percent ?? 0;

  const book = createMemo(() => bookQuery.data);
  const isFb2 = createMemo(() => book()?.format === "fb2");
  const isPdf = createMemo(() => book()?.format === "pdf");
  const canTrackProgress = createMemo(() => isFb2() || (isPdf() && pdfReady()));
  const canRestoreProgress = createMemo(() => (isFb2() && fb2FileQuery.data) || (isPdf() && pdfReady()));

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
    lastSavedProgress = 0;
    setPdfReady(false);
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
      <A href="/library" class={styles.backLink} aria-label={t("library")}>
        <ArrowLeft />
      </A>

      <div class={styles.bookTitle}>
        <Show when={book()} fallback={<span>{t("loading")}</span>}>
          {(currentBook) => <strong>{currentBook().title}</strong>}
        </Show>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={book()?.favorite ? t("removeFromFavorites") : t("addToFavorites")}
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

      if (Math.abs(nextProgress - lastSavedProgress) < 1) {
        return;
      }

      if (updateProgressMutation.isPending) {
        scheduleProgressSave();
        return;
      }

      updateProgressMutation.mutate(
        {
          bookId: targetBookId,
          progressPercent: nextProgress,
        },
        {
          onSuccess: (progress) => {
            lastSavedProgress = progress.progress_percent;
          },
        },
      );
    }, progressSaveDelayMs);
  };

  createEffect(() => {
    const progress = progressQuery.data;
    if (progress) {
      lastSavedProgress = progress.progress_percent;
    }
  });

  createEffect(() => {
    if (!canTrackProgress()) {
      return;
    }

    const onScroll = () => scheduleProgressSave();
    window.addEventListener("scroll", onScroll, { passive: true });

    onCleanup(() => {
      window.removeEventListener("scroll", onScroll);
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
    const restoreDelayMs = isPdf() ? 80 : 350;
    const confirmRestoreDelayMs = isPdf() ? 260 : 900;
    const progressPercent = progress.progress_percent;

    restoreTimeoutIds = [
      window.setTimeout(() => restoreScrollProgress(progressPercent), restoreDelayMs),
      window.setTimeout(
        () => restoreScrollProgress(progressPercent),
        confirmRestoreDelayMs,
      ),
    ];
  });

  onCleanup(() => {
    clearScheduledProgressSave();
    clearScheduledProgressRestore();
  });

  return (
    <div class={styles.readerPage}>
      <Show when={bookQuery.isError}>
        <div class={styles.state}>{t("requestFailedTryAgain")}</div>
      </Show>

      <Show when={bookQuery.isLoading}>
        <LoadingScreen label={t("loading")} />
      </Show>

      <Show when={isFb2()}>
        <Show when={fb2FileQuery.data} fallback={<LoadingScreen label={t("loading")} />}>
          {(fb2) => (
            <Suspense fallback={<LoadingScreen label={t("loading")} />}>
              <Fb2Reader fb2={fb2()} class={styles.fb2Reader} headerContent={chromeContent()} />
            </Suspense>
          )}
        </Show>
      </Show>

      <Show when={isPdf()}>
        <Suspense fallback={<LoadingScreen label={t("loading")} />}>
          <PdfReader
            fileUrl={getBookFileUrl(bookId())}
            class={styles.pdfReader}
            headerContent={chromeContent()}
            onReady={() => setPdfReady(true)}
          />
        </Suspense>
      </Show>
    </div>
  );
}

export default ReaderPage;
