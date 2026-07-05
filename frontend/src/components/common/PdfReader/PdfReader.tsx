import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import ReaderFloatingChrome from "@/components/common/ReaderFloatingChrome/ReaderFloatingChrome";
import WidthRuler from "@/components/common/WidthRuler/WidthRuler";
import { clampWidth, computeWidthRulerMarkers } from "@/components/common/WidthRuler/widthRulerUtils";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./PdfReader.module.scss";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

type PdfPageDescriptor = {
  pageNumber: number;
  width: number;
  height: number;
};

type ScrollAnchor = {
  pageNumber: number;
  offsetRatio: number;
};

const maxRenderPixelRatio = 2;
const headerHideOffset = 128;
const headerShowOffset = 72;
const documentPaddingX = 20;
const minPageWidth = 240;
const minPageHalfWidth = 120;
const guideOutsideMargin = 12;
const resizeAnchorHoldMs = 180;

function renderPixelRatio() {
  return Math.min(maxRenderPixelRatio, Math.max(1, window.devicePixelRatio || 1));
}

function isRenderCancelled(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pageHeightAtWidth(descriptor: PdfPageDescriptor, widthPx: number) {
  return widthPx * (descriptor.height / descriptor.width);
}

function scrollYForAnchor(
  anchor: ScrollAnchor,
  pageList: PdfPageDescriptor[],
  widthPx: number,
  documentTopAbsolute: number,
  paddingTop: number,
  gap: number,
) {
  const descriptor = pageList.find((page) => page.pageNumber === anchor.pageNumber);

  if (!descriptor) {
    return undefined;
  }

  let pageTop = paddingTop;

  for (const page of pageList) {
    if (page.pageNumber === anchor.pageNumber) {
      break;
    }

    pageTop += pageHeightAtWidth(page, widthPx) + gap;
  }

  const pageHeight = pageHeightAtWidth(descriptor, widthPx);

  return documentTopAbsolute + pageTop + pageHeight * anchor.offsetRatio;
}

function PdfReader(props: {
  fileUrl: string;
  title?: string;
  headerContent?: JSX.Element;
  class?: string;
  onReady?: () => void;
}) {
  const { t } = useI18n();
  let rootRef: HTMLDivElement | undefined;
  let documentRef: HTMLElement | undefined;
  let rulerRef: HTMLDivElement | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let pdfDocument: PDFDocumentProxy | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let observer: IntersectionObserver | undefined;
  let observeFrame: number | undefined;
  let destroyed = false;
  let loadGeneration = 0;
  let lockedScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeAnchorTimeout: number | undefined;
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
  const [maxPageWidth, setMaxPageWidth] = createSignal<number | undefined>();
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();

  const isFitWidth = createMemo(() => maxPageWidth() === undefined);
  const availablePageWidth = createMemo(() => Math.max(minPageWidth, documentWidth()));
  const rulerMaxHalfWidth = createMemo(() => {
    if (!rulerRef) {
      return availablePageWidth() / 2;
    }

    return rulerRef.getBoundingClientRect().width / 2;
  });
  const pageWidth = createMemo(() => {
    const customWidth = maxPageWidth();

    if (customWidth === undefined) {
      return availablePageWidth();
    }

    return Math.max(minPageWidth, customWidth);
  });
  const markerStyles = createMemo(() =>
    computeWidthRulerMarkers(
      rulerRef,
      maxPageWidth(),
      availablePageWidth(),
      minPageHalfWidth,
      rulerMaxHalfWidth(),
    ),
  );

  const handleRulerPointer = (event: PointerEvent) => {
    if (!rulerRef || !rootRef) {
      return;
    }

    const rulerRect = rulerRef.getBoundingClientRect();
    const rootRect = rootRef.getBoundingClientRect();
    const rulerCenter = rulerRect.left + rulerRect.width / 2;
    const pageCenter = rootRect.left + rootRect.width / 2;
    const nextHalfWidth = clampWidth(
      Math.abs(event.clientX - rulerCenter),
      minPageHalfWidth,
      rulerRect.width / 2,
    );
    const nextWidth = nextHalfWidth * 2;
    const impliedLeft = pageCenter - nextWidth / 2;
    const impliedRight = pageCenter + nextWidth / 2;
    const outsideGuides =
      event.clientX < impliedLeft - guideOutsideMargin || event.clientX > impliedRight + guideOutsideMargin;

    if (outsideGuides) {
      resetToFitWidth();
      setGuideX(event.clientX);
      return;
    }

    const side = event.clientX < rulerCenter ? -1 : 1;

    setGuideX(rulerCenter + side * nextHalfWidth);
    updatePageWidth(Math.round(nextWidth));
  };

  const captureScrollAnchor = (): ScrollAnchor | undefined => {
    if (!documentRef) {
      return undefined;
    }

    const documentTopAbsolute = documentRef.getBoundingClientRect().top + window.scrollY;
    const documentScrollTop = window.scrollY - documentTopAbsolute;
    const pageList = pages();

    for (let index = pageList.length - 1; index >= 0; index -= 1) {
      const page = pageList[index];
      const pageElement = pageRefs.get(page.pageNumber);

      if (!pageElement) {
        continue;
      }

      const pageTopAbsolute = pageElement.getBoundingClientRect().top + window.scrollY;
      const pageTopInDocument = pageTopAbsolute - documentTopAbsolute;

      if (pageTopInDocument <= documentScrollTop + 0.5) {
        const pageHeight = pageElement.offsetHeight;
        const offsetRatio =
          pageHeight > 0 ? clamp((documentScrollTop - pageTopInDocument) / pageHeight, 0, 1) : 0;

        return { pageNumber: page.pageNumber, offsetRatio };
      }
    }

    const firstPage = pageList[0];

    return firstPage ? { pageNumber: firstPage.pageNumber, offsetRatio: 0 } : undefined;
  };

  const getDocumentLayoutMetrics = () => {
    if (!documentRef) {
      return { paddingTop: 32, gap: 18 };
    }

    const layoutStyles = getComputedStyle(documentRef);

    return {
      paddingTop: Number.parseFloat(layoutStyles.paddingTop) || 32,
      gap: Number.parseFloat(layoutStyles.rowGap) || Number.parseFloat(layoutStyles.gap) || 18,
    };
  };

  const resolvePageWidthPx = (width: number | undefined) => {
    if (width !== undefined) {
      return Math.max(minPageWidth, width);
    }

    if (!rootRef) {
      return Math.max(minPageWidth, documentWidth());
    }

    return Math.max(minPageWidth, rootRef.clientWidth - documentPaddingX * 2);
  };

  const currentScrollAnchor = () => lockedScrollAnchor ?? resizeScrollAnchor ?? captureScrollAnchor();

  const applySynchronizedScrollAnchor = (anchor: ScrollAnchor, targetWidthPx: number) => {
    if (!documentRef) {
      return;
    }

    const metrics = getDocumentLayoutMetrics();
    const documentTopAbsolute = documentRef.getBoundingClientRect().top + window.scrollY;
    const nextScrollY = scrollYForAnchor(
      anchor,
      pages(),
      targetWidthPx,
      documentTopAbsolute,
      metrics.paddingTop,
      metrics.gap,
    );

    if (nextScrollY !== undefined) {
      window.scrollTo(0, nextScrollY);
    }
  };

  const lockResizeScrollAnchor = () => {
    if (lockedScrollAnchor) {
      return;
    }

    resizeScrollAnchor = resizeScrollAnchor ?? captureScrollAnchor();

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    resizeAnchorTimeout = window.setTimeout(() => {
      resizeScrollAnchor = undefined;
      resizeAnchorTimeout = undefined;
    }, resizeAnchorHoldMs);
  };

  const updatePageWidth = (width: number | undefined) => {
    const anchor = currentScrollAnchor();
    const targetWidthPx = resolvePageWidthPx(width);

    if (anchor) {
      applySynchronizedScrollAnchor(anchor, targetWidthPx);
    }

    if (width === undefined) {
      setDocumentWidth(targetWidthPx);
    }

    setMaxPageWidth(width);
    renderedKeys.clear();
  };

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
    if (!rootRef) {
      return;
    }

    const nextWidth = rootRef.clientWidth - documentPaddingX * 2;

    if (Math.abs(nextWidth - documentWidth()) < 0.5) {
      return;
    }

    setDocumentWidth(nextWidth);
  };

  const handleViewportResize = () => {
    if (!rootRef) {
      return;
    }

    const nextWidth = rootRef.clientWidth - documentPaddingX * 2;

    if (Math.abs(nextWidth - documentWidth()) < 0.5) {
      return;
    }

    if (isFitWidth()) {
      lockResizeScrollAnchor();
      const anchor = currentScrollAnchor();

      if (anchor) {
        applySynchronizedScrollAnchor(anchor, nextWidth);
      }

      setDocumentWidth(nextWidth);
      renderedKeys.clear();
      return;
    }

    setDocumentWidth(nextWidth);
  };

  const resetToFitWidth = () => {
    updatePageWidth(undefined);
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
    setMaxPageWidth(undefined);
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
    void pageWidth();
    void isFitWidth();

    for (const descriptor of currentPages) {
      if (currentVisiblePages.has(descriptor.pageNumber)) {
        void renderPage(descriptor);
      }
    }
  });

  createEffect(() => {
    if (!isFitWidth()) {
      return;
    }

    measureDocument();
    renderedKeys.clear();
  });

  const onRulerPointerDown = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLDivElement | null;

    target?.setPointerCapture(event.pointerId);
    lockedScrollAnchor = captureScrollAnchor();
    setDraggingWidth(true);
    setHeaderVisible(true);
    handleRulerPointer(event);
  };

  const onRulerPointerMove = (event: PointerEvent) => {
    if (!draggingWidth()) {
      return;
    }

    handleRulerPointer(event);
  };

  const onRulerPointerUp = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLDivElement | null;

    target?.releasePointerCapture(event.pointerId);
    handleRulerPointer(event);
    lockedScrollAnchor = undefined;
    setDraggingWidth(false);
    setGuideX(undefined);
  };

  onMount(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientY <= headerShowOffset) {
        setHeaderVisible(true);
      } else if (event.clientY >= headerHideOffset && !draggingWidth()) {
        setHeaderVisible(false);
      }
    };

    resizeObserver = new ResizeObserver(() => handleViewportResize());
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
    window.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      resizeObserver?.disconnect();
      observer?.disconnect();
    });
  });

  onCleanup(() => {
    destroyed = true;

    if (observeFrame !== undefined) {
      cancelAnimationFrame(observeFrame);
    }

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    cancelRenderTasks();
    void loadingTask?.destroy().catch(() => undefined);
    void pdfDocument?.cleanup().catch(() => undefined);
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ""}`}>
      <ReaderFloatingChrome
        visible={headerVisible() || draggingWidth()}
        title={props.title}
        headerContent={props.headerContent}
        onShow={() => setHeaderVisible(true)}
        secondaryBar={
          <WidthRuler
            availableWidth={availablePageWidth()}
            currentWidth={pageWidth()}
            maxWidth={rulerMaxHalfWidth() * 2}
            markerStyles={markerStyles()}
            ariaLabel="Ширина страницы"
            minWidth={minPageWidth}
            onRulerRef={(element) => {
              rulerRef = element;
            }}
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={onRulerPointerUp}
          />
        }
      />

      <Show when={draggingWidth() && guideX() !== undefined}>
        <div class={styles.widthGuide} style={{ left: `${guideX()}px` }} aria-hidden="true" />
      </Show>

      <Show when={loading()}>
        <div class={styles.state}>{t("loading")}</div>
      </Show>

      <Show when={failed()}>
        <div class={styles.state}>{t("requestFailedTryAgain")}</div>
      </Show>

      <Show when={!failed()}>
        <main
          ref={documentRef}
          class={styles.document}
          classList={{ [styles.documentFit]: isFitWidth() }}
        >
          <For each={pages()}>
            {(page) => (
              <section
                ref={(element) => {
                  pageRefs.set(page.pageNumber, element);
                }}
                class={styles.page}
                classList={{ [styles.pageFit]: isFitWidth() }}
                data-page-number={page.pageNumber}
                style={{
                  width: isFitWidth() ? undefined : `${pageWidth()}px`,
                  "aspect-ratio": `${page.width} / ${page.height}`,
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
