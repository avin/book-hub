import { A, useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
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
import Fb2Reader from "@/components/common/Fb2Reader/Fb2Reader";
import PdfReader from "@/components/common/PdfReader/PdfReader";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./ReaderPage.module.scss";

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
  const bookId = () => params.bookId;
  const bookQuery = createBookQuery(bookId);
  const progressQuery = createReadingProgressQuery(bookId);
  const fb2FileQuery = createBookFileTextQuery(bookId, () => bookQuery.data?.format === "fb2");
  const updateBookMutation = createUpdateBookMutation();
  const updateProgressMutation = createUpdateReadingProgressMutation();
  const [restoredProgress, setRestoredProgress] = createSignal(false);
  const [pdfReady, setPdfReady] = createSignal(false);
  let saveTimeout: number | undefined;
  let activeBookId = bookId();
  let lastSavedProgress = progressQuery.data?.progress_percent ?? 0;

  const book = createMemo(() => bookQuery.data);
  const isFb2 = createMemo(() => book()?.format === "fb2");
  const isPdf = createMemo(() => book()?.format === "pdf");
  const canTrackProgress = createMemo(() => isFb2() || (isPdf() && pdfReady()));
  const canRestoreProgress = createMemo(() => (isFb2() && fb2FileQuery.data) || (isPdf() && pdfReady()));

  createEffect(() => {
    const currentBookId = bookId();

    if (currentBookId === activeBookId) {
      return;
    }

    activeBookId = currentBookId;
    lastSavedProgress = 0;
    setPdfReady(false);
    setRestoredProgress(false);
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

    if (saveTimeout !== undefined) {
      window.clearTimeout(saveTimeout);
    }

    saveTimeout = window.setTimeout(() => {
      const nextProgress = scrollProgressPercent();

      if (Math.abs(nextProgress - lastSavedProgress) < 1 || updateProgressMutation.isPending) {
        return;
      }

      updateProgressMutation.mutate(
        {
          bookId: bookId(),
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
    if (restoredProgress() || !canRestoreProgress() || !progressQuery.data) {
      return;
    }

    setRestoredProgress(true);
    const restoreDelayMs = isPdf() ? 80 : 350;
    const confirmRestoreDelayMs = isPdf() ? 260 : 900;

    window.setTimeout(() => restoreScrollProgress(progressQuery.data?.progress_percent ?? 0), restoreDelayMs);
    window.setTimeout(() => restoreScrollProgress(progressQuery.data?.progress_percent ?? 0), confirmRestoreDelayMs);
  });

  onCleanup(() => {
    if (saveTimeout !== undefined) {
      window.clearTimeout(saveTimeout);
    }
  });

  return (
    <div class={styles.readerPage}>
      <Show when={bookQuery.isError}>
        <div class={styles.state}>{t("requestFailedTryAgain")}</div>
      </Show>

      <Show when={bookQuery.isLoading}>
        <div class={styles.state}>{t("loading")}</div>
      </Show>

      <Show when={isFb2()}>
        <Show when={fb2FileQuery.data} fallback={<div class={styles.state}>{t("loading")}</div>}>
          {(fb2) => <Fb2Reader fb2={fb2()} class={styles.fb2Reader} headerContent={chromeContent()} />}
        </Show>
      </Show>

      <Show when={isPdf()}>
        <PdfReader
          fileUrl={getBookFileUrl(bookId())}
          title={book()?.title ?? t("reader")}
          class={styles.pdfReader}
          onReady={() => setPdfReady(true)}
        />
      </Show>
    </div>
  );
}

export default ReaderPage;
