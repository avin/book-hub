import * as pdfjs from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import { EventBus, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
  untrack,
} from 'solid-js';
import { ListTree, SlidersHorizontal } from 'lucide-solid';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import PdfFilterPanel from './PdfFilterPanel/PdfFilterPanel';
import useReaderChrome from '@/components/common/ReaderChrome/useReaderChrome';
import useReaderNavigationHistory from '@/components/common/ReaderChrome/useReaderNavigationHistory';
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
  getPdfReaderFilterChainPreference,
  getPdfReaderHorizontalScrollPositionPreference,
  getPdfReaderPageWidthOverflowPreference,
  setPdfReaderContentWidthPreference,
  setPdfReaderFilterChainPreference,
  setPdfReaderHorizontalScrollPositionPreference,
  setPdfReaderPageWidthOverflowPreference,
} from '@/storage/browserPreferences';
import { mapPdfOutline, resolvePdfDestination, type PdfOutlineEntry } from './pdfOutline';
import PdfTextHighlighter from './PdfTextHighlighter';
import {
  defaultPdfFilterChain,
  grayscaleFilterFromChain,
  hasEnabledPdfFilters,
  invertFilterFromChain,
  pdfFilterChainKey,
  softTextEnhancementFilterFromChain,
  textEnhancementFilterFromChain,
  visualAdjustmentFilterFromChain,
  warmthFilterFromChain,
  type PdfFilterChain,
} from './pdfFilters';
import { clampPdfPageWidthOverflow, defaultPdfPageWidthOverflow } from './pdfPageSettings';
import {
  destroySharedPdfWebglFilterRenderer,
  isPdfWebglAvailable,
  isRecoverablePdfFilterError,
  renderPdfPageFilter,
} from './pdfWebglFilter';
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
const documentPaddingX = 20;
const minPageWidth = 240;
const minPageHalfWidth = 120;
const guideOutsideMargin = 12;
const resizeAnchorHoldMs = 180;
const horizontalScrollCenter = 0.5;
const horizontalScrollPositionTolerance = 0.01;
const releasedPageBuffer = 5;

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

function pageWidthWithOverflow(width: number, overflow: number, overflowReferenceWidth = width) {
  return overflow === 0 ? width : overflowReferenceWidth * (1 + overflow / 100);
}

function pageWidthOverflowReference(
  customWidth: number | undefined,
  availableWidth: number,
  viewportWidth: number,
) {
  if (customWidth === undefined || customWidth > availableWidth) {
    return viewportWidth;
  }

  return pageWidthForAvailableWidth(customWidth, availableWidth);
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
  bookId?: string;
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
  let destroyed = false;
  let loadGeneration = 0;
  let lockedScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeAnchorTimeout: number | undefined;
  let horizontalScrollRestoreFrame: number | undefined;
  let horizontalScrollRestoreGeneration = 0;
  let horizontalScrollRestorePending = false;
  let lastHorizontalScrollLeft = 0;
  let lastHorizontalScrollMaxLeft = 0;
  let searchScrollFrame: number | undefined;
  let filterRenderFrame: number | undefined;
  let executedSearchQuery: string | undefined;
  const pageRefs = new Map<number, HTMLElement>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();
  const filteredCanvasRefs = new Map<number, HTMLCanvasElement>();
  const textLayerRefs = new Map<number, HTMLDivElement>();
  const pageCache = new Map<number, PDFPageProxy>();
  const renderTasks = new Map<number, RenderTask>();
  let filterRenderGeneration = 0;
  let filterRenderDebounceTimeout: number | undefined;
  let sharedFilterRenderQueue: Promise<void> = Promise.resolve();
  const filterRenderDebounceMs = 50;
  const textLayerTasks = new Map<number, pdfjs.TextLayer>();
  const textHighlighters = new Map<number, ReturnType<typeof PdfTextHighlighter>>();
  const renderedKeys = new Map<number, string>();
  const filteredKeys = new Map<number, string>();
  const textLayerKeys = new Map<number, string>();
  const [pages, setPages] = createSignal<PdfPageDescriptor[]>([]);
  const [visiblePages, setVisiblePages] = createSignal<ReadonlySet<number>>(new Set());
  const [documentWidth, setDocumentWidth] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [searchValue, setSearchValue] = createSignal('');
  const [searchCount, setSearchCount] = createSignal<{ current: number; total: number }>();
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageInputValue, setPageInputValue] = createSignal('1');
  const [pageInputFocused, setPageInputFocused] = createSignal(false);
  const [tocOpen, setTocOpen] = createSignal(false);
  const [filterPanelOpen, setFilterPanelOpen] = createSignal(false);
  const [filterChain, setFilterChain] = createSignal<PdfFilterChain>(
    untrack(
      () =>
        getPdfReaderFilterChainPreference(props.bookId ?? props.fileUrl) ?? defaultPdfFilterChain(),
    ),
  );
  const [filteredPages, setFilteredPages] = createSignal<ReadonlySet<number>>(new Set());
  const [appliedFilterKeys, setAppliedFilterKeys] = createSignal<ReadonlyMap<number, string>>(
    new Map(),
  );
  const [filterError, setFilterError] = createSignal<string>();
  const [outlineEntries, setOutlineEntries] = createSignal<PdfOutlineEntry[]>([]);
  const [outlineLoaded, setOutlineLoaded] = createSignal(false);
  const [maxPageWidth, setMaxPageWidth] = createSignal<number | undefined>(
    getPdfReaderContentWidthPreference(),
  );
  const [pageWidthOverflow, setPageWidthOverflow] = createSignal(
    untrack(() => getPdfReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl)),
  );
  const [horizontalScrollPosition, setHorizontalScrollPosition] = createSignal<number | undefined>(
    untrack(() => getPdfReaderHorizontalScrollPositionPreference(props.bookId ?? props.fileUrl)),
  );
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
  const [rulerElement, setRulerElement] = createSignal<HTMLDivElement>();
  let filterPreferenceStorageKey: string | undefined;
  let pageWidthOverflowPreferenceStorageKey: string | undefined;
  let horizontalScrollPositionPreferenceStorageKey: string | undefined;

  const isFitWidth = createMemo(() => maxPageWidth() === undefined);
  const availablePageWidth = createMemo(() => Math.max(minPageWidth, documentWidth()));
  const basePageWidth = createMemo(() =>
    pageWidthForAvailableWidth(maxPageWidth(), availablePageWidth()),
  );
  const viewportPageWidth = createMemo(() => availablePageWidth() + documentPaddingX * 2);
  const pageWidthOverflowReferenceWidth = createMemo(() =>
    pageWidthOverflowReference(maxPageWidth(), availablePageWidth(), viewportPageWidth()),
  );
  const pageWidth = createMemo(() =>
    pageWidthWithOverflow(basePageWidth(), pageWidthOverflow(), pageWidthOverflowReferenceWidth()),
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
  const tocLabel = createMemo(() =>
    tocAvailable() ? t('tableOfContents') : t('tableOfContentsUnavailable'),
  );
  const filterKey = createMemo(() => pdfFilterChainKey(filterChain()));
  const filtersEnabled = createMemo(() => hasEnabledPdfFilters(filterChain()));
  const textEnhancementFilter = createMemo(() => textEnhancementFilterFromChain(filterChain()));
  const softTextEnhancementFilter = createMemo(() =>
    softTextEnhancementFilterFromChain(filterChain()),
  );
  const invertFilter = createMemo(() => invertFilterFromChain(filterChain()));
  const visualAdjustmentFilter = createMemo(() => visualAdjustmentFilterFromChain(filterChain()));
  const warmthFilter = createMemo(() => warmthFilterFromChain(filterChain()));
  const grayscaleFilter = createMemo(() => grayscaleFilterFromChain(filterChain()));

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
    const baseWidth = pageWidthForAvailableWidth(
      width === undefined ? undefined : Math.round(width),
      availableWidth,
    );

    return pageWidthWithOverflow(
      baseWidth,
      pageWidthOverflow(),
      pageWidthOverflowReference(width, availableWidth, availableWidth + documentPaddingX * 2),
    );
  };

  const currentScrollAnchor = () =>
    lockedScrollAnchor ?? resizeScrollAnchor ?? captureScrollAnchor();

  const restoreHorizontalScrollPositionIfNeeded = () => {
    if (horizontalScrollRestoreFrame !== undefined) {
      cancelAnimationFrame(horizontalScrollRestoreFrame);
    }

    const generation = ++horizontalScrollRestoreGeneration;
    horizontalScrollRestorePending = true;
    horizontalScrollRestoreFrame = requestAnimationFrame(() => {
      horizontalScrollRestoreFrame = undefined;

      if (generation !== horizontalScrollRestoreGeneration) {
        return;
      }

      const scrollingElement = document.scrollingElement;

      if (scrollingElement) {
        const maxScrollLeft = scrollingElement.scrollWidth - scrollingElement.clientWidth;
        const position = horizontalScrollPosition() ?? horizontalScrollCenter;
        const nextScrollLeft = maxScrollLeft > 0 ? maxScrollLeft * position : 0;

        scrollingElement.scrollLeft = nextScrollLeft;
        lastHorizontalScrollLeft = nextScrollLeft;
        lastHorizontalScrollMaxLeft = maxScrollLeft;
      }

      requestAnimationFrame(() => {
        if (generation === horizontalScrollRestoreGeneration) {
          horizontalScrollRestorePending = false;
        }
      });
    });
  };

  const rememberHorizontalScrollPosition = () => {
    if (horizontalScrollRestorePending) {
      return;
    }

    const scrollingElement = document.scrollingElement;

    if (!scrollingElement) {
      return;
    }

    const maxScrollLeft = scrollingElement.scrollWidth - scrollingElement.clientWidth;
    const scrollLeft = scrollingElement.scrollLeft;

    if (
      maxScrollLeft === lastHorizontalScrollMaxLeft &&
      Math.abs(scrollLeft - lastHorizontalScrollLeft) < 0.5
    ) {
      return;
    }

    lastHorizontalScrollLeft = scrollLeft;
    lastHorizontalScrollMaxLeft = maxScrollLeft;

    if (maxScrollLeft <= 0) {
      return;
    }

    const position = scrollLeft / maxScrollLeft;
    const isLeftmost = scrollLeft <= 1;
    const isCentered =
      Math.abs(position - horizontalScrollCenter) <= horizontalScrollPositionTolerance;
    const nextPosition = isLeftmost || isCentered ? undefined : position;
    const savedPosition = horizontalScrollPosition();

    if (nextPosition === undefined && savedPosition === undefined) {
      return;
    }

    if (
      nextPosition !== undefined &&
      savedPosition !== undefined &&
      Math.abs(nextPosition - savedPosition) < horizontalScrollPositionTolerance
    ) {
      return;
    }

    setHorizontalScrollPosition(nextPosition);
    setPdfReaderHorizontalScrollPositionPreference(props.bookId ?? props.fileUrl, nextPosition);
  };

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

  const scrollToPdfAnchor = (anchor: ScrollAnchor) => {
    const pageElement = pageRefs.get(anchor.pageNumber);

    if (!pageElement) {
      return;
    }

    const pageTop = pageElement.getBoundingClientRect().top + window.scrollY;

    window.scrollTo({
      top: Math.max(0, pageTop + pageElement.offsetHeight * clamp(anchor.offsetRatio, 0, 1)),
      behavior: 'instant',
    });
    setCurrentPage(anchor.pageNumber);
    setPageInputValue(String(anchor.pageNumber));
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

  const readerNavigationHistory = useReaderNavigationHistory({
    readerId: untrack(() => props.bookId ?? props.fileUrl),
    captureLocation: captureScrollAnchor,
    restoreLocation: scrollToPdfAnchor,
    isLocation: (value): value is ScrollAnchor => {
      if (typeof value !== 'object' || value === null) {
        return false;
      }

      const location = value as Partial<ScrollAnchor>;

      return (
        typeof location.pageNumber === 'number' &&
        Number.isInteger(location.pageNumber) &&
        location.pageNumber > 0 &&
        typeof location.offsetRatio === 'number' &&
        Number.isFinite(location.offsetRatio) &&
        location.offsetRatio >= 0 &&
        location.offsetRatio <= 1
      );
    },
  });

  const searchEventBus = new EventBus();
  const searchLinkService = {
    get page() {
      return currentPage();
    },
    set page(pageNumber: number) {
      goToPage(String(pageNumber));
    },
    get pagesCount() {
      return untrack(() => pages().length);
    },
  };
  const findController = new PDFFindController({
    linkService: searchLinkService as never,
    eventBus: searchEventBus,
    delay: 0,
  });

  findController.onIsPageVisible = (pageNumber: number) =>
    untrack(() => visiblePages().has(pageNumber));
  findController.scrollMatchIntoView = ({ element, pageIndex, matchIndex }) => {
    const selected = findController.selected;

    if (selected?.pageIdx !== pageIndex || selected.matchIdx !== matchIndex) {
      return;
    }

    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
    }

    searchScrollFrame = requestAnimationFrame(() => {
      searchScrollFrame = undefined;
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
      syncCurrentPage();
    });
  };

  const updateSearchCount = (matchesCount: { current: number; total: number }) => {
    setSearchCount(matchesCount.total > 0 ? matchesCount : undefined);
  };

  searchEventBus.on(
    'updatefindmatchescount',
    (event: { source: unknown; matchesCount: { current: number; total: number } }) => {
      if (event.source === findController) {
        updateSearchCount(event.matchesCount);
      }
    },
  );
  searchEventBus.on(
    'updatefindcontrolstate',
    (event: { source: unknown; matchesCount: { current: number; total: number } }) => {
      if (event.source === findController) {
        updateSearchCount(event.matchesCount);
      }
    },
  );

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
      setDocumentWidth(resolveAvailablePageWidthPx());
    }

    setMaxPageWidth(width);
    setPdfReaderContentWidthPreference(width);
    renderedKeys.clear();
    invalidateFilteredPages();
    textLayerKeys.clear();
    restoreHorizontalScrollPositionIfNeeded();
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

  const destroyFilterRenderers = () => {
    destroySharedPdfWebglFilterRenderer();
  };

  const invalidateFilteredPages = (options?: { hideFilteredPages?: boolean }) => {
    filterRenderGeneration += 1;
    filteredKeys.clear();

    if (options?.hideFilteredPages) {
      setFilteredPages(new Set<number>());
      setAppliedFilterKeys(new Map());
    }
  };

  const resizeFilteredCanvas = (
    filteredCanvas: HTMLCanvasElement,
    width: number,
    height: number,
    displayWidth: number,
    displayHeight: number,
  ) => {
    if (filteredCanvas.width === width && filteredCanvas.height === height) {
      return;
    }

    filteredCanvas.width = width;
    filteredCanvas.height = height;
    filteredCanvas.style.width = `${displayWidth}px`;
    filteredCanvas.style.height = `${displayHeight}px`;
  };

  const runExclusiveFilterRender = async (action: () => Promise<void>) => {
    const previous = sharedFilterRenderQueue;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    sharedFilterRenderQueue = previous.catch(() => undefined).then(() => current);

    await previous.catch(() => undefined);

    try {
      await action();
    } finally {
      release();
    }
  };

  const setFilterChainState = (nextChain: PdfFilterChain) => {
    setFilterChain(nextChain);
    setFilterError(
      hasEnabledPdfFilters(nextChain) && !isPdfWebglAvailable()
        ? 'pdfFiltersUnavailable'
        : undefined,
    );
    const allFiltersDisabled = !hasEnabledPdfFilters(nextChain);

    invalidateFilteredPages({ hideFilteredPages: allFiltersDisabled });

    if (allFiltersDisabled) {
      destroyFilterRenderers();
    }
  };

  const disablePdfFilters = () => {
    setFilterError('pdfFiltersUnavailable');
    invalidateFilteredPages({ hideFilteredPages: true });
    destroyFilterRenderers();
  };

  const scheduleVisiblePageFilterRender = () => {
    if (filterRenderDebounceTimeout !== undefined) {
      clearTimeout(filterRenderDebounceTimeout);
    }

    if (filterRenderFrame !== undefined) {
      cancelAnimationFrame(filterRenderFrame);
    }

    filterRenderDebounceTimeout = window.setTimeout(() => {
      filterRenderDebounceTimeout = undefined;

      filterRenderFrame = requestAnimationFrame(() => {
        filterRenderFrame = undefined;
        const currentPages = pages();
        const currentVisiblePages = visiblePages();

        for (const descriptor of currentPages) {
          if (currentVisiblePages.has(descriptor.pageNumber)) {
            void renderPage(descriptor);
          }
        }
      });
    }, filterRenderDebounceMs);
  };

  const updateFilterChain = (update: (chain: PdfFilterChain) => PdfFilterChain) => {
    const nextChain = update(filterChain());

    setFilterChainState(nextChain);
    setPdfReaderFilterChainPreference(props.bookId ?? props.fileUrl, nextChain);
    scheduleVisiblePageFilterRender();
  };

  const cancelTextLayerTask = (pageNumber: number) => {
    textLayerTasks.get(pageNumber)?.cancel();
    textLayerTasks.delete(pageNumber);
    textHighlighters.get(pageNumber)?.disable();
    textHighlighters.delete(pageNumber);
  };

  const cancelTextLayerTasks = () => {
    for (const task of textLayerTasks.values()) {
      task.cancel();
    }

    textLayerTasks.clear();

    for (const highlighter of textHighlighters.values()) {
      highlighter.disable();
    }

    textHighlighters.clear();
  };

  const releasePageResources = (pageNumber: number) => {
    cancelRenderTask(pageNumber);
    cancelTextLayerTask(pageNumber);

    const canvas = canvasRefs.get(pageNumber);

    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }

    const filteredCanvas = filteredCanvasRefs.get(pageNumber);

    if (filteredCanvas) {
      filteredCanvas.width = 0;
      filteredCanvas.height = 0;
    }

    const textLayer = textLayerRefs.get(pageNumber);

    if (textLayer) {
      textLayer.textContent = '';
    }

    renderedKeys.delete(pageNumber);
    filteredKeys.delete(pageNumber);
    textLayerKeys.delete(pageNumber);

    setFilteredPages((current) => {
      if (!current.has(pageNumber)) {
        return current;
      }

      const next = new Set(current);
      next.delete(pageNumber);
      return next;
    });
    setAppliedFilterKeys((current) => {
      if (!current.has(pageNumber)) {
        return current;
      }

      const next = new Map(current);
      next.delete(pageNumber);
      return next;
    });
  };

  const hasAllocatedPageResources = (pageNumber: number) => {
    if (
      renderedKeys.has(pageNumber) ||
      filteredKeys.has(pageNumber) ||
      textLayerKeys.has(pageNumber)
    ) {
      return true;
    }

    const canvas = canvasRefs.get(pageNumber);

    if (canvas && (canvas.width > 0 || canvas.height > 0)) {
      return true;
    }

    const filteredCanvas = filteredCanvasRefs.get(pageNumber);

    if (filteredCanvas && (filteredCanvas.width > 0 || filteredCanvas.height > 0)) {
      return true;
    }

    return false;
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
    restoreHorizontalScrollPositionIfNeeded();
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
    const nextBasePageWidth = pageWidthForAvailableWidth(maxPageWidth(), nextAvailableWidth);
    const nextPageWidth = pageWidthWithOverflow(
      nextBasePageWidth,
      pageWidthOverflow(),
      pageWidthOverflowReference(
        maxPageWidth(),
        nextAvailableWidth,
        nextAvailableWidth + documentPaddingX * 2,
      ),
    );

    if (Math.abs(nextPageWidth - pageWidth()) >= 0.5) {
      lockResizeScrollAnchor();
      const anchor = currentScrollAnchor();

      if (anchor) {
        applySynchronizedScrollAnchor(anchor, nextPageWidth);
      }
    }

    if (isFitWidth()) {
      renderedKeys.clear();
      invalidateFilteredPages();
      textLayerKeys.clear();
    }

    setDocumentWidth(nextWidth);
    restoreHorizontalScrollPositionIfNeeded();
  };

  const resetToFitWidth = () => {
    updatePageWidth(undefined);
  };

  const updatePageWidthOverflow = (value: number) => {
    const nextOverflow = clampPdfPageWidthOverflow(value);
    if (nextOverflow === pageWidthOverflow()) return;

    const anchor = currentScrollAnchor();
    const nextPageWidth = pageWidthWithOverflow(
      basePageWidth(),
      nextOverflow,
      pageWidthOverflowReferenceWidth(),
    );

    if (anchor) {
      applySynchronizedScrollAnchor(anchor, nextPageWidth);
    }

    setPageWidthOverflow(nextOverflow);
    setPdfReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl, nextOverflow);
    renderedKeys.clear();
    invalidateFilteredPages();
    textLayerKeys.clear();
    restoreHorizontalScrollPositionIfNeeded();
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
    const filteredCanvas = filteredCanvasRefs.get(descriptor.pageNumber);
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
    const currentFilterKey = filterKey();
    const hasFilters = filtersEnabled() && !filterError();

    if (hasFilters && !filteredCanvas) {
      return;
    }

    if (renderedKeys.get(descriptor.pageNumber) !== renderKey) {
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
      if (filteredCanvas) {
        resizeFilteredCanvas(
          filteredCanvas,
          canvas.width,
          canvas.height,
          displayWidth,
          displayHeight,
        );
      }

      const task = page.render({ canvas, viewport });
      renderTasks.set(descriptor.pageNumber, task);

      try {
        await task.promise;
        renderedKeys.set(descriptor.pageNumber, renderKey);
        filteredKeys.delete(descriptor.pageNumber);
        setFilteredPages((current) => {
          if (!current.has(descriptor.pageNumber)) {
            return current;
          }

          const next = new Set(current);
          next.delete(descriptor.pageNumber);
          return next;
        });
        setAppliedFilterKeys((current) => {
          if (!current.has(descriptor.pageNumber)) {
            return current;
          }

          const next = new Map(current);
          next.delete(descriptor.pageNumber);
          return next;
        });
      } catch (error) {
        if (!isRenderCancelled(error)) {
          setFailed(true);
        }
        return;
      } finally {
        if (renderTasks.get(descriptor.pageNumber) === task) {
          renderTasks.delete(descriptor.pageNumber);
        }
      }
    }

    if (filteredCanvas) {
      resizeFilteredCanvas(
        filteredCanvas,
        canvas.width,
        canvas.height,
        displayWidth,
        displayHeight,
      );
    }

    if (!hasFilters) {
      return;
    }

    if (filteredKeys.get(descriptor.pageNumber) === currentFilterKey) {
      return;
    }

    if (!filteredCanvas) {
      return;
    }

    const filterGenerationAtStart = filterRenderGeneration;
    const filterChainAtStart = filterChain();

    await runExclusiveFilterRender(async () => {
      if (
        filterGenerationAtStart !== filterRenderGeneration ||
        filteredKeys.get(descriptor.pageNumber) === currentFilterKey
      ) {
        return;
      }

      try {
        renderPdfPageFilter(canvas, filteredCanvas, filterChainAtStart);

        if (filterGenerationAtStart !== filterRenderGeneration) {
          return;
        }

        filteredKeys.set(descriptor.pageNumber, currentFilterKey);
        setAppliedFilterKeys((current) => {
          const next = new Map(current);
          next.set(descriptor.pageNumber, currentFilterKey);
          return next;
        });
        setFilteredPages((current) => new Set(current).add(descriptor.pageNumber));
      } catch (error) {
        if (filterGenerationAtStart !== filterRenderGeneration) {
          return;
        }

        if (isRecoverablePdfFilterError(error)) {
          destroyFilterRenderers();
          return;
        }

        console.error('Failed to apply PDF page filter', error);
        disablePdfFilters();
      }
    });
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
    const highlighter = PdfTextHighlighter({
      findController,
      eventBus: searchEventBus,
      pageIndex: descriptor.pageNumber - 1,
    });

    highlighter.setTextMapping(task.textDivs, task.textContentItemsStr);

    textLayerTasks.set(descriptor.pageNumber, task);

    try {
      await task.render();

      if (!destroyed && generation === loadGeneration) {
        textLayerKeys.set(descriptor.pageNumber, renderKey);
        textHighlighters.set(descriptor.pageNumber, highlighter);
        highlighter.enable();
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
    executedSearchQuery = undefined;
    setSearchCount(undefined);
    findController.setDocument(null as never);
    setLoading(true);
    setFailed(false);
    setPages([]);
    setVisiblePages(new Set<number>());
    setOutlineEntries([]);
    setOutlineLoaded(false);
    setTocOpen(false);
    pageRefs.clear();
    canvasRefs.clear();
    filteredCanvasRefs.clear();
    textLayerRefs.clear();
    pageCache.clear();
    renderedKeys.clear();
    invalidateFilteredPages();
    textLayerKeys.clear();
    destroyFilterRenderers();
    cancelRenderTasks();
    cancelTextLayerTasks();
    if (readyFrame !== undefined) {
      cancelAnimationFrame(readyFrame);
      readyFrame = undefined;
    }
    if (filterRenderDebounceTimeout !== undefined) {
      clearTimeout(filterRenderDebounceTimeout);
      filterRenderDebounceTimeout = undefined;
    }
    if (filterRenderFrame !== undefined) {
      cancelAnimationFrame(filterRenderFrame);
      filterRenderFrame = undefined;
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
      findController.setDocument(document);
      setLoading(false);
      readyFrame = requestAnimationFrame(() => {
        readyFrame = undefined;
        if (destroyed || generation !== loadGeneration) {
          return;
        }

        measureDocument();
        restoreHorizontalScrollPositionIfNeeded();
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
    const storageKey = props.bookId ?? props.fileUrl;

    if (storageKey === filterPreferenceStorageKey) {
      return;
    }

    filterPreferenceStorageKey = storageKey;
    const nextChain = getPdfReaderFilterChainPreference(storageKey) ?? defaultPdfFilterChain();

    destroyFilterRenderers();
    setFilterChainState(nextChain);
    scheduleVisiblePageFilterRender();
  });

  createEffect(() => {
    const storageKey = props.bookId ?? props.fileUrl;

    if (storageKey === pageWidthOverflowPreferenceStorageKey) {
      return;
    }

    pageWidthOverflowPreferenceStorageKey = storageKey;
    setPageWidthOverflow(getPdfReaderPageWidthOverflowPreference(storageKey));
    restoreHorizontalScrollPositionIfNeeded();
  });

  createEffect(() => {
    const storageKey = props.bookId ?? props.fileUrl;

    if (storageKey === horizontalScrollPositionPreferenceStorageKey) {
      return;
    }

    horizontalScrollPositionPreferenceStorageKey = storageKey;
    setHorizontalScrollPosition(getPdfReaderHorizontalScrollPositionPreference(storageKey));
    restoreHorizontalScrollPositionIfNeeded();
  });

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
        void renderPage(descriptor).catch((error) => {
          if (!destroyed && !isRenderCancelled(error)) {
            console.error('Failed to render PDF page', error);
          }
        });
        void renderTextLayer(descriptor).catch((error) => {
          if (!destroyed && !isRenderCancelled(error)) {
            console.error('Failed to render PDF text layer', error);
          }
        });
      }
    }
  });

  createEffect(() => {
    const currentPages = pages();
    const currentVisiblePages = visiblePages();

    if (currentPages.length === 0 || currentVisiblePages.size === 0) {
      return;
    }

    let minVisible = Number.POSITIVE_INFINITY;
    let maxVisible = Number.NEGATIVE_INFINITY;

    for (const pageNumber of currentVisiblePages) {
      if (pageNumber < minVisible) {
        minVisible = pageNumber;
      }

      if (pageNumber > maxVisible) {
        maxVisible = pageNumber;
      }
    }

    const retainMin = minVisible - releasedPageBuffer;
    const retainMax = maxVisible + releasedPageBuffer;

    for (const descriptor of currentPages) {
      const pageNumber = descriptor.pageNumber;

      if (pageNumber >= retainMin && pageNumber <= retainMax) {
        continue;
      }

      if (!hasAllocatedPageResources(pageNumber)) {
        continue;
      }

      releasePageResources(pageNumber);
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
    readerChrome.show();
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

    const previousLocation = captureScrollAnchor();

    void resolvePdfDestination(pdfDocument, node.dest, pageWidth()).then((location) => {
      if (!location) {
        return;
      }

      readerNavigationHistory.recordNavigation(location, previousLocation);
      scrollToPdfAnchor(location);
    });
  };

  type SearchDirection = 'next' | 'previous';

  const clearSearchHighlights = () => {
    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
      searchScrollFrame = undefined;
    }

    searchEventBus.dispatch('findbarclose', { source: findController });
    setSearchCount(undefined);
    executedSearchQuery = undefined;
  };
  const search = (direction: SearchDirection) => {
    const query = searchValue().trim();

    if (!query) {
      clearSearchHighlights();
      return;
    }

    const isContinuation = executedSearchQuery === query;
    executedSearchQuery = query;
    searchEventBus.dispatch('find', {
      source: findController,
      type: isContinuation ? 'again' : 'find',
      query,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: direction === 'previous',
      matchDiacritics: false,
    });
  };

  const toggleToc = () => {
    setFilterPanelOpen(false);
    setTocOpen((value) => !value);
  };

  const toggleFilterPanel = () => {
    setTocOpen(false);
    setFilterPanelOpen((value) => !value);
  };

  const toggleInvert = (enabled: boolean) => {
    updateFilterChain((chain) =>
      chain.map((filter) => (filter.id === 'invert' ? { ...filter, enabled } : filter)),
    );
  };

  const toggleTextEnhancement = (enabled: boolean) => {
    updateFilterChain((chain) =>
      chain.map((filter) => (filter.id === 'textEnhancement' ? { ...filter, enabled } : filter)),
    );
  };

  const toggleSoftTextEnhancement = (enabled: boolean) => {
    updateFilterChain((chain) =>
      chain.map((filter) =>
        filter.id === 'softTextEnhancement' ? { ...filter, enabled } : filter,
      ),
    );
  };

  const updateTextEnhancementParameter = (
    parameter: 'strokeWidth' | 'threshold' | 'contrast' | 'grayLevels' | 'toneShift',
    value: number,
  ) => {
    updateFilterChain((chain) =>
      chain.map((filter) =>
        filter.id === 'textEnhancement' ? { ...filter, [parameter]: value } : filter,
      ),
    );
  };

  const updateSoftTextEnhancementParameter = (
    parameter: 'strokeWidth' | 'strength',
    value: number,
  ) => {
    updateFilterChain((chain) =>
      chain.map((filter) =>
        filter.id === 'softTextEnhancement' ? { ...filter, [parameter]: value } : filter,
      ),
    );
  };

  const updateInvertStrength = (strength: number) => {
    updateFilterChain((chain) =>
      chain.map((filter) =>
        filter.id === 'invert' ? { ...filter, strength: clamp(strength, 0, 1) } : filter,
      ),
    );
  };

  const toggleVisualAdjustment = (enabled: boolean) => {
    updateFilterChain((chain) =>
      chain.map((filter) => (filter.id === 'visualAdjustment' ? { ...filter, enabled } : filter)),
    );
  };

  const updateVisualAdjustmentParameter = (
    parameter: 'brightness' | 'contrast' | 'gamma',
    value: number,
  ) => {
    updateFilterChain((chain) =>
      chain.map((filter) =>
        filter.id === 'visualAdjustment' ? { ...filter, [parameter]: value } : filter,
      ),
    );
  };

  const toggleStrengthFilter = (filterId: 'warmth' | 'grayscale', enabled: boolean) => {
    updateFilterChain((chain) =>
      chain.map((filter) => (filter.id === filterId ? { ...filter, enabled } : filter)),
    );
  };

  const updateStrengthFilter = (filterId: 'warmth' | 'grayscale', strength: number) => {
    updateFilterChain((chain) =>
      chain.map((filter) =>
        filter.id === filterId ? { ...filter, strength: clamp(strength, 0, 1) } : filter,
      ),
    );
  };

  const moveFilter = (filterId: PdfFilterChain[number]['id'], targetIndex: number) => {
    updateFilterChain((chain) => {
      const sourceIndex = chain.findIndex((filter) => filter.id === filterId);

      if (sourceIndex < 0 || sourceIndex === targetIndex) {
        return chain;
      }

      const nextChain = [...chain];
      const [movedFilter] = nextChain.splice(sourceIndex, 1);

      if (!movedFilter) {
        return chain;
      }

      nextChain.splice(Math.min(Math.max(targetIndex, 0), nextChain.length), 0, movedFilter);
      return nextChain;
    });
  };

  const resetFilters = () => {
    updateFilterChain(() => defaultPdfFilterChain());
    updatePageWidthOverflow(defaultPdfPageWidthOverflow);
  };

  const readerChrome = useReaderChrome({
    keepVisible: () => tocOpen() || filterPanelOpen() || draggingWidth(),
    onClose: () => {
      setTocOpen(false);
      setFilterPanelOpen(false);
      clearSearchHighlights();
    },
  });

  onMount(() => {
    const onScroll = () => {
      syncCurrentPage();
      rememberHorizontalScrollPosition();
      readerNavigationHistory.updateCurrentLocation();
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
      { root: null, rootMargin: '1200px 0px' },
    );

    if (rootRef) {
      resizeObserver.observe(rootRef);
    }

    measureDocument();
    scheduleObservedPagesSync();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', handleViewportResize);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    onCleanup(() => {
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

    if (filterRenderDebounceTimeout !== undefined) {
      clearTimeout(filterRenderDebounceTimeout);
    }

    if (filterRenderFrame !== undefined) {
      cancelAnimationFrame(filterRenderFrame);
    }

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    if (horizontalScrollRestoreFrame !== undefined) {
      cancelAnimationFrame(horizontalScrollRestoreFrame);
    }

    cancelRenderTasks();
    cancelTextLayerTasks();
    destroyFilterRenderers();
    filteredCanvasRefs.clear();
    textLayerRefs.clear();
    textLayerTasks.clear();
    textLayerKeys.clear();
    void loadingTask?.destroy().catch(() => undefined);
    void pdfDocument?.cleanup().catch(() => undefined);
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ''}`}>
      <ReaderFloatingChrome
        visible={readerChrome.visible()}
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
        onSearchOpen={() => {
          setTocOpen(false);
          setFilterPanelOpen(false);
        }}
        onClose={readerChrome.close}
        onShow={readerChrome.show}
        actions={
          <>
            <Button
              variant="secondary"
              type="button"
              iconOnly
              iconStart={<SlidersHorizontal />}
              title={t('readerAppearance')}
              aria-label={t('readerAppearance')}
              aria-pressed={filterPanelOpen()}
              onClick={toggleFilterPanel}
            />
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
          </>
        }
        secondaryBar={
          <WidthRuler
            availableWidth={availablePageWidth()}
            currentWidth={basePageWidth()}
            markerStyles={markerStyles()}
            ariaLabel={t('pageWidth')}
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

      <PdfFilterPanel
        open={filterPanelOpen()}
        filterChain={filterChain()}
        textEnhancementFilter={
          textEnhancementFilter() ?? textEnhancementFilterFromChain(defaultPdfFilterChain())!
        }
        softTextEnhancementFilter={
          softTextEnhancementFilter() ??
          softTextEnhancementFilterFromChain(defaultPdfFilterChain())!
        }
        invertFilter={invertFilter() ?? invertFilterFromChain(defaultPdfFilterChain())!}
        visualAdjustmentFilter={
          visualAdjustmentFilter() ?? visualAdjustmentFilterFromChain(defaultPdfFilterChain())!
        }
        warmthFilter={warmthFilter() ?? warmthFilterFromChain(defaultPdfFilterChain())!}
        grayscaleFilter={grayscaleFilter() ?? grayscaleFilterFromChain(defaultPdfFilterChain())!}
        pageWidthOverflow={pageWidthOverflow()}
        available={!filterError()}
        unavailableMessage={filterError() ? t('pdfFiltersUnavailable') : undefined}
        onClose={() => setFilterPanelOpen(false)}
        onToggleTextEnhancement={toggleTextEnhancement}
        onTextEnhancementParameterChange={updateTextEnhancementParameter}
        onToggleSoftTextEnhancement={toggleSoftTextEnhancement}
        onSoftTextEnhancementParameterChange={updateSoftTextEnhancementParameter}
        onToggleInvert={toggleInvert}
        onStrengthChange={updateInvertStrength}
        onToggleVisualAdjustment={toggleVisualAdjustment}
        onVisualAdjustmentParameterChange={updateVisualAdjustmentParameter}
        onToggleWarmth={(enabled) => toggleStrengthFilter('warmth', enabled)}
        onWarmthStrengthChange={(strength) => updateStrengthFilter('warmth', strength)}
        onToggleGrayscale={(enabled) => toggleStrengthFilter('grayscale', enabled)}
        onGrayscaleStrengthChange={(strength) => updateStrengthFilter('grayscale', strength)}
        onMoveFilter={moveFilter}
        onPageWidthOverflowChange={updatePageWidthOverflow}
        onReset={resetFilters}
        onAutoWidth={resetToFitWidth}
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
            if (readerChrome.toggleOnTouch(event)) {
              event.preventDefault();
            }
          }}
          onClick={readerChrome.onDocumentClick}
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
                data-applied-filter-key={appliedFilterKeys().get(page.pageNumber) ?? ''}
                style={{
                  width: `${Math.round(pageWidth())}px`,
                  'max-width': pageWidthOverflow() > 0 ? 'none' : '100%',
                  'aspect-ratio': `${page.width} / ${page.height}`,
                }}
                aria-label={`${t('page')} ${page.pageNumber}`}
              >
                <canvas
                  class={styles.sourceCanvas}
                  classList={{
                    [styles.sourceCanvasHidden]:
                      filtersEnabled() && filteredPages().has(page.pageNumber),
                  }}
                  ref={(element) => {
                    canvasRefs.set(page.pageNumber, element);
                  }}
                />
                <Show when={filtersEnabled()}>
                  <canvas
                    class={styles.filteredCanvas}
                    classList={{
                      [styles.filteredCanvasVisible]: filteredPages().has(page.pageNumber),
                    }}
                    ref={(element) => {
                      if (!element) {
                        filteredCanvasRefs.delete(page.pageNumber);
                        return;
                      }

                      filteredCanvasRefs.set(page.pageNumber, element);

                      onCleanup(() => {
                        filteredCanvasRefs.delete(page.pageNumber);
                      });
                    }}
                    aria-hidden="true"
                  />
                </Show>
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
