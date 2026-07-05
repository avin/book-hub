import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./PdfReader.module.scss";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

type PdfPageDescriptor = {
  pageNumber: number;
  width: number;
  height: number;
};

const maxRenderPixelRatio = 2;
const headerHideOffset = 128;
const headerShowOffset = 72;

function renderPixelRatio() {
  return Math.min(maxRenderPixelRatio, Math.max(1, window.devicePixelRatio || 1));
}

function isRenderCancelled(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function PdfReader(props: {
  fileUrl: string;
  title: string;
  class?: string;
  onReady?: () => void;
}) {
  const { t } = useI18n();
  let rootRef: HTMLDivElement | undefined;
  let documentRef: HTMLElement | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let pdfDocument: PDFDocumentProxy | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let observer: IntersectionObserver | undefined;
  let observeFrame: number | undefined;
  let destroyed = false;
  let loadGeneration = 0;
  const pageRefs = new Map<number, HTMLElement>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();
  const pageCache = new Map<number, PDFPageProxy>();
  const renderTasks = new Map<number, RenderTask>();
  const renderedKeys = new Map<number, string>();
  const [pages, setPages] = createSignal<PdfPageDescriptor[]>([]);
  const [visiblePages, setVisiblePages] = createSignal<ReadonlySet<number>>(new Set());
  const [documentWidth, setDocumentWidth] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [headerVisible, setHeaderVisible] = createSignal(false);

  const cancelRenderTask = (pageNumber: number) => {
    renderTasks.get(pageNumber)?.cancel();
    renderTasks.delete(pageNumber);
  };

  const cancelRenderTasks = () => {
    for (const task of renderTasks.values()) {
      task.cancel();
    }

    renderTasks.clear();
  };

  const measureDocument = () => {
    if (!documentRef) {
      return;
    }

    setDocumentWidth(documentRef.getBoundingClientRect().width);
  };

  const syncObservedPages = () => {
    if (!observer) {
      return;
    }

    observer.disconnect();

    for (const page of pages()) {
      const element = pageRefs.get(page.pageNumber);

      if (element) {
        observer.observe(element);
      }
    }
  };

  const scheduleObservedPagesSync = () => {
    if (observeFrame !== undefined) {
      cancelAnimationFrame(observeFrame);
    }

    observeFrame = requestAnimationFrame(() => {
      syncObservedPages();
      observeFrame = undefined;
    });
  };

  const getPage = async (pageNumber: number) => {
    const cachedPage = pageCache.get(pageNumber);

    if (cachedPage) {
      return cachedPage;
    }

    if (!pdfDocument) {
      return undefined;
    }

    const page = await pdfDocument.getPage(pageNumber);
    pageCache.set(pageNumber, page);

    return page;
  };

  const renderPage = async (descriptor: PdfPageDescriptor) => {
    const canvas = canvasRefs.get(descriptor.pageNumber);
    const pageElement = pageRefs.get(descriptor.pageNumber);

    if (!canvas || !pageElement || !pdfDocument) {
      return;
    }

    const cssWidth = pageElement.clientWidth;

    if (cssWidth <= 0) {
      return;
    }

    const ratio = renderPixelRatio();
    const renderKey = `${Math.round(cssWidth)}:${ratio}`;

    if (renderedKeys.get(descriptor.pageNumber) === renderKey) {
      return;
    }

    const page = await getPage(descriptor.pageNumber);

    if (!page || destroyed) {
      return;
    }

    cancelRenderTask(descriptor.pageNumber);

    const scale = cssWidth / descriptor.width;
    const viewport = page.getViewport({ scale: scale * ratio });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${viewport.width / ratio}px`;
    canvas.style.height = `${viewport.height / ratio}px`;

    const task = page.render({ canvas, viewport });
    renderTasks.set(descriptor.pageNumber, task);

    try {
      await task.promise;
      renderedKeys.set(descriptor.pageNumber, renderKey);
    } catch (error) {
      if (!isRenderCancelled(error)) {
        setFailed(true);
      }
    } finally {
      if (renderTasks.get(descriptor.pageNumber) === task) {
        renderTasks.delete(descriptor.pageNumber);
      }
    }
  };

  const loadDocument = async () => {
    const generation = loadGeneration + 1;

    loadGeneration = generation;
    setLoading(true);
    setFailed(false);
    setPages([]);
    setVisiblePages(new Set());
    pageRefs.clear();
    canvasRefs.clear();
    pageCache.clear();
    renderedKeys.clear();
    cancelRenderTasks();
    const previousLoadingTask = loadingTask;
    const previousDocument = pdfDocument;

    loadingTask = undefined;
    pdfDocument = undefined;
    await previousLoadingTask?.destroy().catch(() => undefined);
    await previousDocument?.cleanup().catch(() => undefined);
    loadingTask = pdfjs.getDocument({ url: props.fileUrl, withCredentials: true });

    try {
      const document = await loadingTask.promise;

      if (destroyed || generation !== loadGeneration) {
        await document.cleanup();
        return;
      }

      const nextPages: PdfPageDescriptor[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);

        if (destroyed || generation !== loadGeneration) {
          await document.cleanup();
          return;
        }

        const viewport = page.getViewport({ scale: 1 });

        pageCache.set(pageNumber, page);
        nextPages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
        });
      }

      pdfDocument = document;
      setPages(nextPages);
      setLoading(false);
      requestAnimationFrame(() => {
        measureDocument();
        props.onReady?.();
      });
    } catch (error) {
      if (!destroyed && generation === loadGeneration && !isRenderCancelled(error)) {
        setFailed(true);
        setLoading(false);
      }
    }
  };

  createEffect(() => {
    void props.fileUrl;
    void loadDocument();
  });

  createEffect(() => {
    void pages();
    scheduleObservedPagesSync();
  });

  createEffect(() => {
    const currentPages = pages();
    const currentVisiblePages = visiblePages();

    void documentWidth();

    for (const descriptor of currentPages) {
      if (currentVisiblePages.has(descriptor.pageNumber)) {
        void renderPage(descriptor);
      }
    }
  });

  onMount(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientY <= headerShowOffset) {
        setHeaderVisible(true);
      } else if (event.clientY >= headerHideOffset) {
        setHeaderVisible(false);
      }
    };

    resizeObserver = new ResizeObserver(() => measureDocument());
    observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((current) => {
          const next = new Set(current);

          for (const entry of entries) {
            const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);

            if (!Number.isFinite(pageNumber)) {
              continue;
            }

            if (entry.isIntersecting) {
              next.add(pageNumber);
            } else {
              next.delete(pageNumber);
            }
          }

          return next;
        });
      },
      { root: null, rootMargin: "1200px 0px" },
    );

    if (rootRef) {
      resizeObserver.observe(rootRef);
    }

    measureDocument();
    scheduleObservedPagesSync();
    window.addEventListener("pointermove", onPointerMove);

    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      resizeObserver?.disconnect();
      observer?.disconnect();
    });
  });

  onCleanup(() => {
    destroyed = true;

    if (observeFrame !== undefined) {
      cancelAnimationFrame(observeFrame);
    }

    cancelRenderTasks();
    void loadingTask?.destroy().catch(() => undefined);
    void pdfDocument?.cleanup().catch(() => undefined);
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ""}`}>
      <div class={styles.hoverZone} aria-hidden="true" onPointerEnter={() => setHeaderVisible(true)} />

      <header
        class={styles.header}
        classList={{ [styles.visible]: headerVisible() }}
        onPointerEnter={() => setHeaderVisible(true)}
      >
        <div class={styles.headerBar}>
          <div class={styles.bookTitle}>{props.title}</div>
        </div>
      </header>

      <Show when={loading()}>
        <div class={styles.state}>{t("loading")}</div>
      </Show>

      <Show when={failed()}>
        <div class={styles.state}>{t("requestFailedTryAgain")}</div>
      </Show>

      <Show when={!failed()}>
        <main ref={documentRef} class={styles.document}>
          <For each={pages()}>
            {(page) => (
              <section
                ref={(element) => {
                  pageRefs.set(page.pageNumber, element);
                }}
                class={styles.page}
                data-page-number={page.pageNumber}
                style={{
                  "aspect-ratio": `${page.width} / ${page.height}`,
                  "--pdf-page-width": `${page.width}px`,
                }}
                aria-label={`Страница ${page.pageNumber}`}
              >
                <canvas
                  ref={(element) => {
                    canvasRefs.set(page.pageNumber, element);
                  }}
                />
              </section>
            )}
          </For>
        </main>
      </Show>
    </div>
  );
}

export default PdfReader;
