import * as pdfjs from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { ListTree } from 'lucide-solid';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import ReaderFloatingChrome from '@/components/common/ReaderFloatingChrome/ReaderFloatingChrome';
import TextInput from '@/components/common/TextInput/TextInput';
import TocPanel from '@/components/common/TocPanel/TocPanel';
import type { TocEntry } from '@/components/common/TocPanel/TocList/TocList';
import WidthRuler from '@/components/common/WidthRuler/WidthRuler';
import {
  clampWidth,
  computeWidthRulerMarkers,
} from '@/components/common/WidthRuler/widthRulerUtils';
import { useI18n } from '@/i18n/I18nProvider';
import { pdfjsDocumentParams, pdfjsWorkerSrc } from '@/api/pdfjsConfig';
import {
  getPdfReaderContentWidthPreference,
  setPdfReaderContentWidthPreference,
} from '@/storage/browserPreferences';
import { mapPdfOutline, scrollToPdfDestination, type PdfOutlineEntry } from './pdfOutline';
import {
  findPdfSearchMatches,
  normalizePdfSearchQuery,
  pdfTextItemsToSearchText,
  type PdfSearchMatch,
  type PdfTextItem,
} from './pdfSearch';
import styles from './PdfReader.module.scss';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

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
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pageHeightAtWidth(descriptor: PdfPageDescriptor, widthPx: number) {
  return widthPx * (descriptor.height / descriptor.width);
}

function pageWidthForAvailableWidth(customWidth: number | undefined, availableWidth: number) {
  if (customWidth === undefined) {
    return availableWidth;
  }

  return Math.min(availableWidth, Math.max(minPageWidth, customWidth));
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
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let pdfDocument: PDFDocumentProxy | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let observer: IntersectionObserver | undefined;
  let observeFrame: number | undefined;
  let readyFrame: number | undefined;
  let touchToggleClickTimeout: number | undefined;
  let ignoreNextDocumentClick = false;
  let destroyed = false;
  let loadGeneration = 0;
  let lockedScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeAnchorTimeout: number | undefined;
  let searchScrollFrame: number | undefined;
  let searchLoadGeneration = 0;
  let executedSearchQuery: string | undefined;
  const pageRefs = new Map<number, HTMLElement>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();
  const textLayerRefs = new Map<number, HTMLDivElement>();
  const pageCache = new Map<number, PDFPageProxy>();
  const renderTasks = new Map<number, RenderTask>();
  const textLayerTasks = new Map<number, pdfjs.TextLayer>();
  const renderedKeys = new Map<number, string>();
  const textLayerKeys = new Map<number, string>();
  const pageSearchTexts = new Map<number, string>();
  const [pages, setPages] = createSignal<PdfPageDescriptor[]>([]);
  const [visiblePages, setVisiblePages] = createSignal<ReadonlySet<number>>(new Set());
  const [documentWidth, setDocumentWidth] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const [searchValue, setSearchValue] = createSignal('');
  const [searchMatches, setSearchMatches] = createSignal<PdfSearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = createSignal<number | undefined>();
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageInputValue, setPageInputValue] = createSignal('1');
  const [pageInputFocused, setPageInputFocused] = createSignal(false);
  const [tocOpen, setTocOpen] = createSignal(false);
  const [outlineEntries, setOutlineEntries] = createSignal<PdfOutlineEntry[]>([]);
  const [outlineLoaded, setOutlineLoaded] = createSignal(false);
  const [maxPageWidth, setMaxPageWidth] = createSignal<number | undefined>(
    getPdfReaderContentWidthPreference(),
  );
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
  const [rulerElement, setRulerElement] = createSignal<HTMLDivElement>();

  const isFitWidth = createMemo(() => maxPageWidth() === undefined);
  const availablePageWidth = createMemo(() => Math.max(minPageWidth, documentWidth()));
  const pageWidth = createMemo(() =>
    pageWidthForAvailableWidth(maxPageWidth(), availablePageWidth()),
  );
  const markerStyles = createMemo(() =>
    computeWidthRulerMarkers(
      rulerElement(),
      maxPageWidth(),
      availablePageWidth(),
      minPageHalfWidth,
    ),
  );
  const tocEntries = createMemo<TocEntry[]>(() => outlineEntries());
  const tocAvailable = createMemo(() => outlineLoaded() && tocEntries().length > 0);
  const tocLabel = createMemo(() => (tocAvailable() ? 'Оглавление' : 'Оглавление недоступно'));
  const searchCount = createMemo(() => {
    const total = searchMatches().length;
    const active = activeSearchIndex();

    return total > 0 && active !== undefined ? { current: active + 1, total } : undefined;
  });

  const handleRulerPointer = (event: PointerEvent) => {
    const currentRulerElement = rulerElement();

    if (!currentRulerElement || !rootRef) {
      return;
    }

    const rulerRect = currentRulerElement.getBoundingClientRect();
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
      event.clientX < impliedLeft - guideOutsideMargin ||
      event.clientX > impliedRight + guideOutsideMargin;

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

  const resolveAvailablePageWidthPx = () => {
    if (!rootRef) {
      return availablePageWidth();
    }

    return Math.max(minPageWidth, Math.round(rootRef.clientWidth - documentPaddingX * 2));
  };

  const resolvePageWidthPx = (width: number | undefined) => {
    const availableWidth = resolveAvailablePageWidthPx();

    return pageWidthForAvailableWidth(
      width === undefined ? undefined : Math.round(width),
      availableWidth,
    );
  };

  const currentScrollAnchor = () =>
    lockedScrollAnchor ?? resizeScrollAnchor ?? captureScrollAnchor();

  const syncCurrentPage = () => {
    const pageList = pages();

    if (pageList.length === 0) {
      return;
    }

    const viewportCenter = window.innerHeight / 2;
    let closestPage = pageList[0].pageNumber;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const page of pageList) {
      const element = pageRefs.get(page.pageNumber);

      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();

      if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
        closestPage = page.pageNumber;
        break;
      }

      const distance =
        viewportCenter < rect.top ? rect.top - viewportCenter : viewportCenter - rect.bottom;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = page.pageNumber;
      }
    }

    setCurrentPage(closestPage);

    if (!pageInputFocused()) {
      setPageInputValue(String(closestPage));
    }
  };

  const goToPage = (value: string) => {
    const pageList = pages();

    if (pageList.length === 0) {
      return;
    }

    const parsedPage = Number.parseInt(value, 10);
    const nextPage = clamp(
      Number.isFinite(parsedPage) ? parsedPage : currentPage(),
      1,
      pageList.length,
    );
    const element = pageRefs.get(nextPage);

    if (!element) {
      return;
    }

    const topOffset = 96;
    const nextScrollTop = element.getBoundingClientRect().top + window.scrollY - topOffset;

    window.scrollTo({ top: Math.max(0, nextScrollTop), behavior: 'instant' });
    setCurrentPage(nextPage);
    setPageInputValue(String(nextPage));
  };

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
    setPdfReaderContentWidthPreference(width);
    renderedKeys.clear();
    textLayerKeys.clear();
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

  const cancelTextLayerTask = (pageNumber: number) => {
    textLayerTasks.get(pageNumber)?.cancel();
    textLayerTasks.delete(pageNumber);
  };

  const cancelTextLayerTasks = () => {
    for (const task of textLayerTasks.values()) {
      task.cancel();
    }

    textLayerTasks.clear();
  };

  const measureDocument = () => {
    if (!rootRef) {
      return;
    }

    const nextWidth = Math.round(rootRef.clientWidth - documentPaddingX * 2);

    if (nextWidth === documentWidth()) {
      return;
    }

    setDocumentWidth(nextWidth);
  };

  const handleViewportResize = () => {
    if (!rootRef) {
      return;
    }

    const nextWidth = Math.round(rootRef.clientWidth - documentPaddingX * 2);

    if (nextWidth === documentWidth()) {
      return;
    }

    const nextAvailableWidth = Math.max(minPageWidth, nextWidth);
    const nextPageWidth = pageWidthForAvailableWidth(maxPageWidth(), nextAvailableWidth);

    if (Math.abs(nextPageWidth - pageWidth()) >= 0.5) {
      lockResizeScrollAnchor();
      const anchor = currentScrollAnchor();

      if (anchor) {
        applySynchronizedScrollAnchor(anchor, nextPageWidth);
      }
    }

    if (isFitWidth()) {
      renderedKeys.clear();
      textLayerKeys.clear();
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

  const clearLayerSearchHighlights = (layer: HTMLDivElement) => {
    for (const mark of layer.querySelectorAll<HTMLElement>('mark[data-search-match]')) {
      const parent = mark.parentNode;

      if (!parent) {
        continue;
      }

      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }

      mark.remove();
    }
  };

  const applySearchHighlights = (pageNumber: number) => {
    const layer = textLayerRefs.get(pageNumber);

    if (!layer) {
      return;
    }

    clearLayerSearchHighlights(layer);

    const pageMatches = searchMatches().filter((match) => match.pageNumber === pageNumber);

    if (pageMatches.length === 0) {
      return;
    }

    const textNodes: { node: Text; start: number; end: number }[] = [];
    const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    let offset = 0;

    while (currentNode instanceof Text) {
      if (currentNode.data.length === 0) {
        currentNode = walker.nextNode();
        continue;
      }

      const end = offset + currentNode.data.length;

      textNodes.push({ node: currentNode, start: offset, end });
      offset = end + 1;
      currentNode = walker.nextNode();
    }

    const segmentsByNode = new Map<
      Text,
      { start: number; end: number; match: PdfSearchMatch; active: boolean }[]
    >();
    const activeIndex = activeSearchIndex();

    for (const match of pageMatches) {
      const matchIndex = searchMatches().indexOf(match);

      for (const textNode of textNodes) {
        const start = Math.max(match.start, textNode.start);
        const end = Math.min(match.end, textNode.end);

        if (start >= end) {
          continue;
        }

        const segments = segmentsByNode.get(textNode.node) ?? [];
        segments.push({
          start: start - textNode.start,
          end: end - textNode.start,
          match,
          active: matchIndex === activeIndex,
        });
        segmentsByNode.set(textNode.node, segments);
      }
    }

    for (const [textNode, segments] of segmentsByNode) {
      for (const segment of [...segments].sort((left, right) => right.start - left.start)) {
        const after =
          segment.end < textNode.data.length ? textNode.splitText(segment.end) : undefined;
        const selected = segment.start > 0 ? textNode.splitText(segment.start) : textNode;
        const mark = layer.ownerDocument.createElement('mark');
        const parent = textNode.parentNode;

        mark.dataset.searchMatch = segment.match.key;
        mark.dataset.searchActive = String(segment.active);

        if (parent) {
          if (selected === textNode) {
            parent.insertBefore(mark, textNode);
          } else if (after) {
            parent.insertBefore(mark, after);
          } else {
            parent.appendChild(mark);
          }

          mark.appendChild(selected);
        }
      }
    }
  };

  const loadPageSearchTexts = async (generation: number) => {
    for (const descriptor of pages()) {
      if (pageSearchTexts.has(descriptor.pageNumber)) {
        continue;
      }

      const page = await getPage(descriptor.pageNumber);

      if (!page || destroyed || generation !== loadGeneration) {
        return false;
      }

      const textContent = await page.getTextContent();
      const textItems: PdfTextItem[] = textContent.items.flatMap((item) =>
        'str' in item ? [{ str: item.str }] : [],
      );
      pageSearchTexts.set(descriptor.pageNumber, pdfTextItemsToSearchText(textItems));
    }

    return true;
  };

  const renderPage = async (descriptor: PdfPageDescriptor) => {
    const canvas = canvasRefs.get(descriptor.pageNumber);
    const pageElement = pageRefs.get(descriptor.pageNumber);

    if (!canvas || !pageElement || !pdfDocument) {
      return;
    }

    const displayWidth = Math.round(pageElement.clientWidth);

    if (displayWidth <= 0) {
      return;
    }

    const ratio = renderPixelRatio();
    const displayHeight = Math.round(displayWidth * (descriptor.height / descriptor.width));
    const renderKey = `${displayWidth}:${ratio}`;

    if (renderedKeys.get(descriptor.pageNumber) === renderKey) {
      return;
    }

    const page = await getPage(descriptor.pageNumber);

    if (!page || destroyed) {
      return;
    }

    cancelRenderTask(descriptor.pageNumber);

    const scale = (displayWidth * ratio) / descriptor.width;
    const viewport = page.getViewport({ scale });

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

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

  const renderTextLayer = async (descriptor: PdfPageDescriptor) => {
    const generation = loadGeneration;
    const layer = textLayerRefs.get(descriptor.pageNumber);
    const pageElement = pageRefs.get(descriptor.pageNumber);

    if (!layer || !pageElement) {
      return;
    }

    const displayWidth = Math.round(pageElement.clientWidth);

    if (displayWidth <= 0) {
      return;
    }

    const ratio = renderPixelRatio();
    const displayHeight = Math.round(displayWidth * (descriptor.height / descriptor.width));
    const renderKey = `${displayWidth}:${ratio}`;

    if (textLayerKeys.get(descriptor.pageNumber) === renderKey) {
      return;
    }

    const page = await getPage(descriptor.pageNumber);

    if (!page || destroyed || generation !== loadGeneration) {
      return;
    }

    cancelTextLayerTask(descriptor.pageNumber);

    const scale = (displayWidth * ratio) / descriptor.width;
    const viewport = page.getViewport({ scale });

    pageElement.style.setProperty('--scale-factor', `${displayWidth / descriptor.width}`);
    layer.style.width = `${displayWidth}px`;
    layer.style.height = `${displayHeight}px`;
    layer.textContent = '';

    const task = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: layer,
      viewport,
    });

    textLayerTasks.set(descriptor.pageNumber, task);

    try {
      await task.render();

      if (!destroyed && generation === loadGeneration) {
        textLayerKeys.set(descriptor.pageNumber, renderKey);
        applySearchHighlights(descriptor.pageNumber);
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        (error.name === 'AbortException' || isRenderCancelled(error))
      )) {
        console.error('Failed to render PDF text layer', error);
      }
    } finally {
      if (textLayerTasks.get(descriptor.pageNumber) === task) {
        textLayerTasks.delete(descriptor.pageNumber);
      }
    }
  };

  const loadDocument = async () => {
    const generation = loadGeneration + 1;

    loadGeneration = generation;
    searchLoadGeneration += 1;
    executedSearchQuery = undefined;
    setLoading(true);
    setFailed(false);
    setPages([]);
    setVisiblePages(new Set<number>());
    setOutlineEntries([]);
    setOutlineLoaded(false);
    setTocOpen(false);
    pageRefs.clear();
    canvasRefs.clear();
    textLayerRefs.clear();
    pageCache.clear();
    renderedKeys.clear();
    textLayerKeys.clear();
    pageSearchTexts.clear();
    setSearchMatches([]);
    setActiveSearchIndex(undefined);
    cancelRenderTasks();
    cancelTextLayerTasks();
    if (readyFrame !== undefined) {
      cancelAnimationFrame(readyFrame);
      readyFrame = undefined;
    }
    const previousLoadingTask = loadingTask;
    const previousDocument = pdfDocument;

    loadingTask = undefined;
    pdfDocument = undefined;
    await previousLoadingTask?.destroy().catch(() => undefined);
    await previousDocument?.cleanup().catch(() => undefined);
    loadingTask = pdfjs.getDocument({
      url: props.fileUrl,
      withCredentials: true,
      ...pdfjsDocumentParams,
    });

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
      const rawOutline = await document.getOutline();

      if (destroyed || generation !== loadGeneration) {
        await document.cleanup();
        return;
      }

      setOutlineEntries(mapPdfOutline(rawOutline));
      setOutlineLoaded(true);
      setPages(nextPages);
      setLoading(false);
      readyFrame = requestAnimationFrame(() => {
        readyFrame = undefined;
        if (destroyed || generation !== loadGeneration) {
          return;
        }

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
        void renderTextLayer(descriptor);
      }
    }
  });

  createEffect(() => {
    const matches = searchMatches();
    const activeIndex = activeSearchIndex();
    const currentVisiblePages = visiblePages();

    void matches;
    void activeIndex;

    for (const pageNumber of currentVisiblePages) {
      applySearchHighlights(pageNumber);
    }
  });

  createEffect(() => {
    if (!isFitWidth()) {
      return;
    }

    measureDocument();
    renderedKeys.clear();
    textLayerKeys.clear();
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

  const onTocSelect = (_entry: TocEntry, path: number[]) => {
    if (!pdfDocument) {
      return;
    }

    let nodes = outlineEntries();
    let node: PdfOutlineEntry | undefined;

    for (const index of path) {
      node = nodes[index];

      if (!node) {
        return;
      }

      nodes = node.children ?? [];
    }

    if (!node) {
      return;
    }

    void scrollToPdfDestination(pdfDocument, node.dest, pageRefs, documentRef, pageWidth());
  };

  type SearchDirection = 'next' | 'previous';

  const clearSearchHighlights = () => {
    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
      searchScrollFrame = undefined;
    }

    searchLoadGeneration += 1;

    for (const layer of textLayerRefs.values()) {
      clearLayerSearchHighlights(layer);
    }

    setSearchMatches([]);
    setActiveSearchIndex(undefined);
    executedSearchQuery = undefined;
  };

  const firstSearchMatchIndex = (matches: PdfSearchMatch[], direction: SearchDirection) => {
    const page = currentPage();
    const pageElement = pageRefs.get(page);
    const pageText = pageSearchTexts.get(page) ?? '';
    const pageTop = pageElement ? pageElement.getBoundingClientRect().top + window.scrollY : 0;
    const pageOffset = pageElement
      ? clamp(window.scrollY - pageTop, 0, pageElement.offsetHeight)
      : 0;
    const textOffset =
      pageElement && pageElement.offsetHeight > 0
        ? (pageOffset / pageElement.offsetHeight) * pageText.length
        : 0;

    if (direction === 'next') {
      const index = matches.findIndex(
        (match) =>
          match.pageNumber > page || (match.pageNumber === page && match.start >= textOffset),
      );

      return index === -1 ? 0 : index;
    }

    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (
        matches[index].pageNumber < page ||
        (matches[index].pageNumber === page && matches[index].end <= textOffset)
      ) {
        return index;
      }
    }

    return matches.length - 1;
  };

  const scrollToSearchMatch = (match: PdfSearchMatch) => {
    const focusRenderedMatch = (attempt = 0) => {
      applySearchHighlights(match.pageNumber);
      const target = rootRef?.querySelector<HTMLElement>(
        `[data-search-match="${match.key}"][data-search-active="true"]`,
      );
      const pageElement = pageRefs.get(match.pageNumber);

      if (target) {
        searchScrollFrame = undefined;
        target.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else if (pageElement && attempt < 20) {
        pageElement?.scrollIntoView({ behavior: 'instant', block: 'center' });
        searchScrollFrame = requestAnimationFrame(() => focusRenderedMatch(attempt + 1));
      }

      setCurrentPage(match.pageNumber);

      if (!pageInputFocused()) {
        setPageInputValue(String(match.pageNumber));
      }
    };

    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
    }

    searchScrollFrame = requestAnimationFrame(() => {
      searchScrollFrame = undefined;
      focusRenderedMatch();
    });
  };

  const search = async (direction: SearchDirection) => {
    const query = normalizePdfSearchQuery(searchValue());

    if (!query) {
      clearSearchHighlights();
      executedSearchQuery = query;
      return;
    }

    const activeIndex = activeSearchIndex();
    const isContinuation =
      executedSearchQuery === query && activeIndex !== undefined && searchMatches().length > 0;

    if (isContinuation) {
      const matches = searchMatches();
      const nextIndex =
        direction === 'next'
          ? (activeIndex + 1) % matches.length
          : (activeIndex - 1 + matches.length) % matches.length;

      setActiveSearchIndex(nextIndex);
      scrollToSearchMatch(matches[nextIndex]);
      return;
    }

    const generation = loadGeneration;
    const requestGeneration = ++searchLoadGeneration;

    for (const layer of textLayerRefs.values()) {
      clearLayerSearchHighlights(layer);
    }

    setSearchMatches([]);
    setActiveSearchIndex(undefined);

    if (!(await loadPageSearchTexts(generation)) || requestGeneration !== searchLoadGeneration) {
      return;
    }

    const matches = findPdfSearchMatches(pageSearchTexts, query);
    setSearchMatches(matches);
    executedSearchQuery = query;

    if (matches.length === 0) {
      return;
    }

    const nextIndex = firstSearchMatchIndex(matches, direction);
    setActiveSearchIndex(nextIndex);
    scrollToSearchMatch(matches[nextIndex]);
  };

  const toggleToc = () => {
    setTocOpen((value) => !value);
  };

  const closeChrome = () => {
    setTocOpen(false);
    setHeaderVisible(false);
    clearSearchHighlights();
  };

  const isReaderInputFocused = () => document.activeElement instanceof HTMLInputElement;

  const toggleChromeOnTouch = (event: PointerEvent) => {
    if (
      event.pointerType !== 'touch' ||
      event.clientY < window.innerHeight * 0.25 ||
      event.clientY > window.innerHeight * 0.75
    ) {
      return false;
    }

    setHeaderVisible((current) => !current);
    ignoreNextDocumentClick = true;

    if (touchToggleClickTimeout !== undefined) {
      window.clearTimeout(touchToggleClickTimeout);
    }

    touchToggleClickTimeout = window.setTimeout(() => {
      ignoreNextDocumentClick = false;
      touchToggleClickTimeout = undefined;
    }, 500);

    return true;
  };

  createEffect(() => {
    if (tocOpen()) {
      setHeaderVisible(true);
    }
  });

  onMount(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientY <= headerShowOffset || event.clientY >= window.innerHeight - 88) {
        setHeaderVisible(true);
      } else if (
        event.clientY >= headerHideOffset &&
        !draggingWidth() &&
        !tocOpen() &&
        !isReaderInputFocused()
      ) {
        setHeaderVisible(false);
      }
    };

    const onScroll = () => syncCurrentPage();

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
      { root: null, rootMargin: '1200px 0px' },
    );

    if (rootRef) {
      resizeObserver.observe(rootRef);
    }

    measureDocument();
    scheduleObservedPagesSync();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', handleViewportResize);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    onCleanup(() => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', handleViewportResize);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      resizeObserver?.disconnect();
      observer?.disconnect();
    });
  });

  onCleanup(() => {
    destroyed = true;

    if (observeFrame !== undefined) {
      cancelAnimationFrame(observeFrame);
    }

    if (readyFrame !== undefined) {
      cancelAnimationFrame(readyFrame);
    }

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    if (touchToggleClickTimeout !== undefined) {
      window.clearTimeout(touchToggleClickTimeout);
    }

    cancelRenderTasks();
    cancelTextLayerTasks();
    textLayerRefs.clear();
    textLayerTasks.clear();
    textLayerKeys.clear();
    void loadingTask?.destroy().catch(() => undefined);
    void pdfDocument?.cleanup().catch(() => undefined);
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ''}`}>
      <ReaderFloatingChrome
        visible={headerVisible() || draggingWidth() || tocOpen()}
        title={props.title}
        headerContent={props.headerContent}
        searchValue={searchValue()}
        searchCount={searchCount()}
        bottomContent={
          <label class={styles.pageControl}>
            <span class={styles.pageControlLabel}>{t('page')}</span>
            <TextInput
              class={styles.pageInput}
              type="number"
              min="1"
              max={pages().length || undefined}
              value={pageInputValue()}
              aria-label={t('pageNumber')}
              onFocus={(event) => {
                setPageInputFocused(true);
                event.currentTarget.select();
              }}
              onInput={(event) => setPageInputValue(event.currentTarget.value)}
              onBlur={() => {
                setPageInputFocused(false);
                goToPage(pageInputValue());
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToPage(pageInputValue());
                  event.currentTarget.blur();
                }
              }}
            />
            <span>/ {pages().length}</span>
          </label>
        }
        onSearchValueChange={setSearchValue}
        onSearchNext={() => void search('next')}
        onSearchPrevious={() => void search('previous')}
        onSearchOpen={() => setTocOpen(false)}
        onClose={closeChrome}
        onShow={() => setHeaderVisible(true)}
        actions={
          <Button
            variant="secondary"
            type="button"
            iconOnly
            iconStart={<ListTree />}
            title={tocLabel()}
            aria-label={tocLabel()}
            aria-pressed={tocOpen()}
            disabled={!tocAvailable()}
            onClick={toggleToc}
          />
        }
        secondaryBar={
          <WidthRuler
            availableWidth={availablePageWidth()}
            currentWidth={pageWidth()}
            markerStyles={markerStyles()}
            ariaLabel="Ширина страницы"
            minWidth={minPageWidth}
            onRulerRef={(element) => {
              setRulerElement(element);
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

      <TocPanel
        open={tocOpen()}
        entries={tocEntries()}
        onClose={() => setTocOpen(false)}
        onSelect={onTocSelect}
      />

      <Show when={loading()}>
        <LoadingScreen label={t('loading')} />
      </Show>

      <Show when={failed()}>
        <div class={styles.state}>{t('requestFailedTryAgain')}</div>
      </Show>

      <Show when={!failed() && !loading()}>
        <main
          ref={documentRef}
          class={styles.document}
          classList={{ [styles.documentFit]: isFitWidth() }}
          onPointerUp={(event) => {
            if (toggleChromeOnTouch(event)) {
              event.preventDefault();
            }
          }}
          onClick={() => {
            if (ignoreNextDocumentClick) {
              ignoreNextDocumentClick = false;
              return;
            }

            closeChrome();
          }}
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
                  width: `${Math.round(pageWidth())}px`,
                  'max-width': '100%',
                  'aspect-ratio': `${page.width} / ${page.height}`,
                }}
                aria-label={`Страница ${page.pageNumber}`}
              >
                <canvas
                  ref={(element) => {
                    canvasRefs.set(page.pageNumber, element);
                  }}
                />
                <div
                  ref={(element) => {
                    textLayerRefs.set(page.pageNumber, element);
                  }}
                  class={styles.textLayer}
                  data-testid="pdf-text-layer"
                  aria-hidden="true"
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
