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
  untrack,
} from 'solid-js';
import { ListTree, SlidersHorizontal } from 'lucide-solid';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import FixedLayoutFilterPanel from '../FixedLayoutFilterPanel/FixedLayoutFilterPanel';
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
import { pdfjsWorkerSrc } from '@/api/pdfjsConfig';
import { createFixedLayoutReader } from '../FixedLayoutReader/fixedLayoutReader';
import {
  getFixedLayoutReaderContentWidthPreference,
  getFixedLayoutReaderFilterChainPreference,
  getFixedLayoutReaderHorizontalScrollPositionPreference,
  getFixedLayoutReaderPageWidthOverflowPreference,
  setFixedLayoutReaderContentWidthPreference,
  setFixedLayoutReaderFilterChainPreference,
  setFixedLayoutReaderHorizontalScrollPositionPreference,
  setFixedLayoutReaderPageWidthOverflowPreference,
} from '@/storage/browserPreferencesFixedLayout';
import { mapPdfOutline, type PdfOutlineEntry } from './pdfOutline';
import { createPdfFixedLayoutAdapter } from './pdfFixedLayoutAdapter';
import {
  pdfPageTileCount,
  pdfTileBounds,
  pdfTileDistanceToZone,
  pdfTileRangeInZone,
  type PdfTileBounds,
} from './pdfPageTiles';
import PdfTextHighlighter from './PdfTextHighlighter';
import {
  defaultFixedLayoutFilterChain as defaultPdfFilterChain,
  fixedLayoutFilterChainKey as pdfFilterChainKey,
  grayscaleFilterFromFixedLayoutChain as grayscaleFilterFromChain,
  hasEnabledFixedLayoutFilters as hasEnabledPdfFilters,
  invertFilterFromFixedLayoutChain as invertFilterFromChain,
  softTextEnhancementFilterFromFixedLayoutChain as softTextEnhancementFilterFromChain,
  textEnhancementFilterFromFixedLayoutChain as textEnhancementFilterFromChain,
  visualAdjustmentFilterFromFixedLayoutChain as visualAdjustmentFilterFromChain,
  warmthFilterFromFixedLayoutChain as warmthFilterFromChain,
  type FixedLayoutFilterChain as PdfFilterChain,
} from '../FixedLayoutReader/fixedLayoutFilters';
import {
  clampFixedLayoutPageWidthOverflow,
  defaultFixedLayoutPageWidthOverflow,
} from '../FixedLayoutReader/fixedLayoutPageSettings';
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

type PdfTileJob = {
  key: string;
  pageNumber: number;
  index: number;
  tileCount: number;
  distance: number;
};

type PdfTile = {
  key: string;
  pageNumber: number;
  index: number;
  tileCount: number;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  filteredCanvas?: HTMLCanvasElement;
  renderKey?: string;
  filterKey?: string;
  task?: RenderTask;
};

type PdfTextLayerJob = {
  descriptor: PdfPageDescriptor;
  distance: number;
};

const maxRenderPixelRatio = 2;
const maxConcurrentRenderJobs = 2;
const maxRenderMargin = 1200;
const tileKeepViewportFactor = 3;
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
  let tileUpdateFrame: number | undefined;
  let executedSearchQuery: string | undefined;
  const pageRefs = new Map<number, HTMLElement>();
  const tileLayerRefs = new Map<number, HTMLDivElement>();
  const textLayerRefs = new Map<number, HTMLDivElement>();
  const pageCache = new Map<number, PDFPageProxy>();
  const tiles = new Map<string, PdfTile>();
  const runningTileRenderKeys = new Map<string, string>();
  let tileQueue: PdfTileJob[] = [];
  let textLayerQueue: PdfTextLayerJob[] = [];
  let activeRenderJobs = 0;
  let filterRenderGeneration = 0;
  let filterRenderDebounceTimeout: number | undefined;
  let sharedFilterRenderQueue: Promise<void> = Promise.resolve();
  const filterRenderDebounceMs = 50;
  const textLayerTasks = new Map<number, pdfjs.TextLayer>();
  const textHighlighters = new Map<number, ReturnType<typeof PdfTextHighlighter>>();
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
        getFixedLayoutReaderFilterChainPreference(props.bookId ?? props.fileUrl) ??
        defaultPdfFilterChain(),
    ),
  );
  const [filterError, setFilterError] = createSignal<string>();
  const [outlineEntries, setOutlineEntries] = createSignal<PdfOutlineEntry[]>([]);
  const [outlineLoaded, setOutlineLoaded] = createSignal(false);
  const [maxPageWidth, setMaxPageWidth] = createSignal<number | undefined>(
    getFixedLayoutReaderContentWidthPreference(),
  );
  const [pageWidthOverflow, setPageWidthOverflow] = createSignal(
    untrack(() => getFixedLayoutReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl)),
  );
  const [horizontalScrollPosition, setHorizontalScrollPosition] = createSignal<number | undefined>(
    untrack(() =>
      getFixedLayoutReaderHorizontalScrollPositionPreference(props.bookId ?? props.fileUrl),
    ),
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

    const pageList = pages();
    const index = lastPageIndexStartingAbove(pageList, 0.5);
    const page = index >= 0 ? pageList[index] : undefined;
    const pageElement = page ? pageRefs.get(page.pageNumber) : undefined;

    if (page && pageElement) {
      const pageTop = pageElement.getBoundingClientRect().top;
      const pageHeight = pageElement.offsetHeight;
      const offsetRatio = pageHeight > 0 ? clamp(-pageTop / pageHeight, 0, 1) : 0;

      return { pageNumber: page.pageNumber, offsetRatio };
    }

    const firstPage = pageList[0];

    return firstPage ? { pageNumber: firstPage.pageNumber, offsetRatio: 0 } : undefined;
  };

  // Страницы идут в DOM сверху вниз, поэтому их верхние границы монотонны.
  const lastPageIndexStartingAbove = (pageList: PdfPageDescriptor[], viewportY: number) => {
    let low = 0;
    let high = pageList.length - 1;
    let result = -1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const element = pageRefs.get(pageList[middle].pageNumber);

      if (!element) {
        return linearLastPageIndexStartingAbove(pageList, viewportY);
      }

      if (element.getBoundingClientRect().top <= viewportY) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return result;
  };

  const linearLastPageIndexStartingAbove = (pageList: PdfPageDescriptor[], viewportY: number) => {
    for (let index = pageList.length - 1; index >= 0; index -= 1) {
      const element = pageRefs.get(pageList[index].pageNumber);

      if (element && element.getBoundingClientRect().top <= viewportY) {
        return index;
      }
    }

    return -1;
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
    setFixedLayoutReaderHorizontalScrollPositionPreference(
      props.bookId ?? props.fileUrl,
      nextPosition,
    );
  };

  const syncCurrentPage = () => {
    const pageList = pages();

    if (pageList.length === 0) {
      return;
    }

    const viewportCenter = window.innerHeight / 2;
    const index = lastPageIndexStartingAbove(pageList, viewportCenter);
    let closestPage = pageList[Math.max(0, index)].pageNumber;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of [pageList[index], pageList[index + 1]]) {
      const element = candidate ? pageRefs.get(candidate.pageNumber) : undefined;

      if (!candidate || !element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const distance =
        viewportCenter < rect.top
          ? rect.top - viewportCenter
          : Math.max(0, viewportCenter - rect.bottom);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = candidate.pageNumber;
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
  const pdfAdapter = createPdfFixedLayoutAdapter({
    fileUrl: () => props.fileUrl,
    onLoadingTask: (task) => {
      loadingTask = task;
    },
    searchLinkService,
  });
  const pdfFixedLayoutReader = createFixedLayoutReader(pdfAdapter.adapter);
  const { findController, searchEventBus } = pdfAdapter;

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
    setFixedLayoutReaderContentWidthPreference(width);
    invalidateFilteredPages();
    textLayerKeys.clear();
    restoreHorizontalScrollPositionIfNeeded();
  };

  const showTileSource = (tile: PdfTile) => {
    tile.canvas.classList.remove(styles.tileCanvasHidden);
    tile.filteredCanvas?.classList.add(styles.tileCanvasHidden);
  };

  const showTileFiltered = (tile: PdfTile) => {
    tile.filteredCanvas?.classList.remove(styles.tileCanvasHidden);
    tile.canvas.classList.add(styles.tileCanvasHidden);
  };

  const releaseTile = (tile: PdfTile) => {
    runningTileRenderKeys.delete(tile.key);
    tile.task?.cancel();
    tile.task = undefined;
    tile.canvas.width = 0;
    tile.canvas.height = 0;

    if (tile.filteredCanvas) {
      tile.filteredCanvas.width = 0;
      tile.filteredCanvas.height = 0;
    }

    tile.element.remove();
    tiles.delete(tile.key);
  };

  const releaseTiles = (predicate: (tile: PdfTile) => boolean = () => true) => {
    for (const tile of [...tiles.values()]) {
      if (predicate(tile)) {
        releaseTile(tile);
      }
    }
  };

  const destroyFilterRenderers = () => {
    destroySharedPdfWebglFilterRenderer();
  };

  const invalidateFilteredPages = (options?: { hideFilteredPages?: boolean }) => {
    filterRenderGeneration += 1;

    for (const tile of tiles.values()) {
      tile.filterKey = undefined;

      if (options?.hideFilteredPages) {
        showTileSource(tile);

        if (tile.filteredCanvas) {
          tile.filteredCanvas.width = 0;
          tile.filteredCanvas.height = 0;
        }
      }
    }
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

    filterRenderDebounceTimeout = window.setTimeout(() => {
      filterRenderDebounceTimeout = undefined;
      scheduleTileUpdate();
    }, filterRenderDebounceMs);
  };

  const updateFilterChain = (update: (chain: PdfFilterChain) => PdfFilterChain) => {
    const nextChain = update(filterChain());

    setFilterChainState(nextChain);
    setFixedLayoutReaderFilterChainPreference(props.bookId ?? props.fileUrl, nextChain);
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
    releaseTiles((tile) => tile.pageNumber === pageNumber);
    cancelTextLayerTask(pageNumber);

    const textLayer = textLayerRefs.get(pageNumber);

    if (textLayer) {
      textLayer.textContent = '';
    }

    textLayerKeys.delete(pageNumber);
    pageCache.delete(pageNumber);
    void pdfFixedLayoutReader.releasePage(pageNumber);
  };

  const hasAllocatedPageResources = (pageNumber: number) => {
    if (textLayerKeys.has(pageNumber) || textLayerTasks.has(pageNumber)) {
      return true;
    }

    for (const tile of tiles.values()) {
      if (tile.pageNumber === pageNumber) {
        return true;
      }
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
    const nextOverflow = clampFixedLayoutPageWidthOverflow(value);
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
    setFixedLayoutReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl, nextOverflow);
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

    const page = await pdfFixedLayoutReader.renderPage(pageNumber);

    if (!page) {
      return undefined;
    }

    pageCache.set(pageNumber, page);

    return page;
  };

  const pageDescriptor = (pageNumber: number) => {
    const pageList = pages();
    const descriptor = pageList[pageNumber - 1];

    return descriptor?.pageNumber === pageNumber
      ? descriptor
      : pageList.find((page) => page.pageNumber === pageNumber);
  };

  const pageRenderGeometry = (descriptor: PdfPageDescriptor) => {
    const pageElement = pageRefs.get(descriptor.pageNumber);

    if (!pageElement) {
      return undefined;
    }

    const displayWidth = Math.round(pageElement.clientWidth);

    if (displayWidth <= 0) {
      return undefined;
    }

    const ratio = renderPixelRatio();
    const displayHeight = pageHeightAtWidth(descriptor, displayWidth);

    return {
      pageElement,
      ratio,
      deviceWidth: Math.round(displayWidth * ratio),
      deviceHeight: Math.round(displayHeight * ratio),
      tileCount: pdfPageTileCount(displayHeight),
      renderKey: `${displayWidth}:${ratio}`,
    };
  };

  const tileKey = (pageNumber: number, tileCount: number, index: number) =>
    `${pageNumber}:${tileCount}:${index}`;

  const createTile = (job: PdfTileJob, tileLayer: HTMLDivElement): PdfTile => {
    const element = document.createElement('div');
    const canvas = document.createElement('canvas');

    element.className = styles.tile;
    element.style.zIndex = String(job.index + 1);
    canvas.className = styles.tileCanvas;
    canvas.width = 0;
    canvas.height = 0;
    element.append(canvas);
    tileLayer.append(element);

    const tile: PdfTile = {
      key: job.key,
      pageNumber: job.pageNumber,
      index: job.index,
      tileCount: job.tileCount,
      element,
      canvas,
    };

    tiles.set(tile.key, tile);

    return tile;
  };

  const positionTile = (tile: PdfTile, bounds: PdfTileBounds, pageDeviceHeight: number) => {
    tile.element.style.top = `${(bounds.deviceTop / pageDeviceHeight) * 100}%`;
    tile.element.style.height = `${(bounds.deviceHeight / pageDeviceHeight) * 100}%`;
  };

  const applyTileFilter = async (tile: PdfTile) => {
    const currentFilterKey = filterKey();
    const filterGenerationAtStart = filterRenderGeneration;
    const filterChainAtStart = filterChain();
    let applied = false;

    await runExclusiveFilterRender(async () => {
      if (
        filterGenerationAtStart !== filterRenderGeneration ||
        tiles.get(tile.key) !== tile ||
        tile.filterKey === currentFilterKey
      ) {
        return;
      }

      if (!tile.filteredCanvas) {
        tile.filteredCanvas = document.createElement('canvas');
        tile.filteredCanvas.className = `${styles.tileCanvas} ${styles.tileCanvasHidden}`;
        tile.filteredCanvas.setAttribute('aria-hidden', 'true');
        tile.element.append(tile.filteredCanvas);
      }

      try {
        renderPdfPageFilter(tile.canvas, tile.filteredCanvas, filterChainAtStart);

        if (filterGenerationAtStart !== filterRenderGeneration) {
          return;
        }

        tile.filterKey = currentFilterKey;
        showTileFiltered(tile);
        applied = true;
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

    return applied;
  };

  const renderTile = async (job: PdfTileJob) => {
    const descriptor = pageDescriptor(job.pageNumber);
    const geometry = descriptor ? pageRenderGeometry(descriptor) : undefined;
    const tileLayer = tileLayerRefs.get(job.pageNumber);

    if (!descriptor || !geometry || !tileLayer || geometry.tileCount !== job.tileCount) {
      return false;
    }

    let tile = tiles.get(job.key);

    if (tile?.renderKey !== geometry.renderKey) {
      runningTileRenderKeys.set(job.key, geometry.renderKey);

      try {
        tile = await renderTileSource(job, descriptor, geometry, tileLayer);
      } finally {
        if (runningTileRenderKeys.get(job.key) === geometry.renderKey) {
          runningTileRenderKeys.delete(job.key);
        }
      }

      if (!tile) {
        return false;
      }
    }

    if (!filtersEnabled() || filterError() || tile.filterKey === filterKey()) {
      return true;
    }

    return applyTileFilter(tile);
  };

  const renderTileSource = async (
    job: PdfTileJob,
    descriptor: PdfPageDescriptor,
    geometry: NonNullable<ReturnType<typeof pageRenderGeometry>>,
    tileLayer: HTMLDivElement,
  ) => {
    const page = await getPage(job.pageNumber);

    if (!page || destroyed || runningTileRenderKeys.get(job.key) !== geometry.renderKey) {
      return undefined;
    }

    const tile = tiles.get(job.key) ?? createTile(job, tileLayer);
    tile.task?.cancel();

    const bounds = pdfTileBounds(
      job.index,
      job.tileCount,
      geometry.deviceHeight,
      Math.ceil(geometry.ratio),
    );
    const viewport = page.getViewport({
      scale: geometry.deviceWidth / descriptor.width,
      offsetY: -bounds.deviceTop,
    });
    const canvas = tile.canvas;
    // Перерисовка уже показанной полосы идёт во внеэкранный canvas:
    // смена размеров видимого canvas очищает его, и страница мигает пустой.
    const hasPreviousFrame = canvas.width > 0 && canvas.height > 0;
    const renderTarget = hasPreviousFrame ? document.createElement('canvas') : canvas;

    renderTarget.width = geometry.deviceWidth;
    renderTarget.height = bounds.deviceHeight;

    if (!hasPreviousFrame) {
      positionTile(tile, bounds, geometry.deviceHeight);
    }

    const task = page.render({ canvas: renderTarget, viewport });
    tile.task = task;

    try {
      await task.promise;
    } catch (error) {
      if (!isRenderCancelled(error)) {
        setFailed(true);
      }
      return undefined;
    } finally {
      if (tile.task === task) {
        tile.task = undefined;
      }
    }

    if (tiles.get(tile.key) !== tile) {
      return undefined;
    }

    if (renderTarget !== canvas) {
      canvas.width = renderTarget.width;
      canvas.height = renderTarget.height;
      canvas.getContext('2d')?.drawImage(renderTarget, 0, 0);
      renderTarget.width = 0;
      renderTarget.height = 0;
      positionTile(tile, bounds, geometry.deviceHeight);
    }

    tile.renderKey = geometry.renderKey;
    tile.filterKey = undefined;
    showTileSource(tile);

    return tile;
  };

  const isTileRendering = (key: string, renderKey: string) =>
    runningTileRenderKeys.get(key) === renderKey;

  const tileNeedsRender = (job: PdfTileJob, renderKey: string, hasFilters: boolean) => {
    if (isTileRendering(job.key, renderKey)) {
      return false;
    }

    const tile = tiles.get(job.key);

    return !tile || tile.renderKey !== renderKey || (hasFilters && tile.filterKey !== filterKey());
  };

  const cancelTileRender = (key: string) => {
    runningTileRenderKeys.delete(key);

    const tile = tiles.get(key);

    tile?.task?.cancel();

    if (tile) {
      tile.task = undefined;
    }
  };

  const runRenderJob = (job: Promise<boolean>) => {
    const generation = loadGeneration;

    activeRenderJobs += 1;
    void job
      .catch((error: unknown) => {
        if (!destroyed && !isRenderCancelled(error)) {
          console.error('Failed to render PDF page', error);
        }

        return false;
      })
      .then((rendered) => {
        if (destroyed || generation !== loadGeneration) {
          return;
        }

        activeRenderJobs -= 1;
        pumpRenderJobs();

        // После отрисовки очереди нужно убрать полосы старой раскладки страниц.
        if (rendered && tileQueue.length === 0) {
          scheduleTileUpdate();
        }
      });
  };

  // Сначала рисуются полосы, затем текстовый слой: он не виден и не должен
  // задерживать появление изображения при быстрой прокрутке.
  const pumpRenderJobs = () => {
    while (activeRenderJobs < maxConcurrentRenderJobs) {
      const tileJob = tileQueue.shift();

      if (tileJob) {
        runRenderJob(renderTile(tileJob));
        continue;
      }

      const textLayerJob = textLayerQueue.shift();

      if (textLayerJob) {
        runRenderJob(renderTextLayer(textLayerJob.descriptor).then(() => false));
        continue;
      }

      break;
    }
  };

  const updateTiles = () => {
    if (destroyed || !pdfDocument) {
      return;
    }

    const viewportHeight = window.innerHeight;
    const renderMargin = Math.min(maxRenderMargin, viewportHeight);
    const keepMargin = viewportHeight * tileKeepViewportFactor;
    const hasFilters = filtersEnabled() && !filterError();
    const tileJobs: PdfTileJob[] = [];
    const renderZoneTileKeys = new Set<string>();
    const nextTextLayerQueue: PdfTextLayerJob[] = [];
    const keptTileKeys = new Set<string>();
    const currentLayouts = new Map<number, number>();
    const completePages = new Set<number>();

    for (const pageNumber of visiblePages()) {
      const descriptor = pageDescriptor(pageNumber);
      const geometry = descriptor ? pageRenderGeometry(descriptor) : undefined;

      if (!descriptor || !geometry) {
        continue;
      }

      const { pageElement, tileCount, renderKey } = geometry;
      const pageTop = pageElement.getBoundingClientRect().top + pageElement.clientTop;
      const pageHeight = pageElement.clientHeight;
      const renderRange = pdfTileRangeInZone(
        pageTop,
        pageHeight,
        tileCount,
        -renderMargin,
        viewportHeight + renderMargin,
      );
      const keepRange = pdfTileRangeInZone(
        pageTop,
        pageHeight,
        tileCount,
        -keepMargin,
        viewportHeight + keepMargin,
      );

      currentLayouts.set(pageNumber, tileCount);

      if (keepRange) {
        for (let index = keepRange.first; index <= keepRange.last; index += 1) {
          keptTileKeys.add(tileKey(pageNumber, tileCount, index));
        }
      }

      if (!renderRange) {
        continue;
      }

      let pageComplete = true;
      let pageDistance = Number.POSITIVE_INFINITY;

      for (let index = renderRange.first; index <= renderRange.last; index += 1) {
        const job: PdfTileJob = {
          key: tileKey(pageNumber, tileCount, index),
          pageNumber,
          index,
          tileCount,
          distance: pdfTileDistanceToZone(pageTop, pageHeight, tileCount, index, 0, viewportHeight),
        };

        pageDistance = Math.min(pageDistance, job.distance);
        renderZoneTileKeys.add(job.key);

        if (tileNeedsRender(job, renderKey, hasFilters)) {
          tileJobs.push(job);
          pageComplete = false;
        } else if (isTileRendering(job.key, renderKey)) {
          pageComplete = false;
        }
      }

      if (pageComplete) {
        completePages.add(pageNumber);
      }

      if (textLayerKeys.get(pageNumber) !== renderKey && !textLayerTasks.has(pageNumber)) {
        nextTextLayerQueue.push({ descriptor, distance: pageDistance });
      }
    }

    releaseTiles((tile) => {
      const tileCount = currentLayouts.get(tile.pageNumber);

      if (tileCount === undefined) {
        return false;
      }

      if (tile.tileCount !== tileCount) {
        tile.element.style.zIndex = '0';
        return completePages.has(tile.pageNumber);
      }

      return !keptTileKeys.has(tile.key);
    });

    // Быстрый переход к далёкой странице не должен ждать уже ненужных рендеров.
    for (const key of [...runningTileRenderKeys.keys()]) {
      if (!renderZoneTileKeys.has(key)) {
        cancelTileRender(key);
      }
    }

    const byDistance = (left: { distance: number }, right: { distance: number }) =>
      left.distance - right.distance;

    tileQueue = tileJobs.sort(
      (left, right) =>
        byDistance(left, right) || left.pageNumber - right.pageNumber || left.index - right.index,
    );
    textLayerQueue = nextTextLayerQueue.sort(byDistance);
    pumpRenderJobs();
  };

  const scheduleTileUpdate = () => {
    if (tileUpdateFrame !== undefined) {
      return;
    }

    tileUpdateFrame = requestAnimationFrame(() => {
      tileUpdateFrame = undefined;
      updateTiles();
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
    pdfAdapter.setSearchDocument(null);
    setLoading(true);
    setFailed(false);
    setPages([]);
    setVisiblePages(new Set<number>());
    setOutlineEntries([]);
    setOutlineLoaded(false);
    setTocOpen(false);
    releaseTiles();
    tileQueue = [];
    textLayerQueue = [];
    activeRenderJobs = 0;
    pageRefs.clear();
    tileLayerRefs.clear();
    textLayerRefs.clear();
    pageCache.clear();
    invalidateFilteredPages();
    textLayerKeys.clear();
    destroyFilterRenderers();
    cancelTextLayerTasks();
    if (readyFrame !== undefined) {
      cancelAnimationFrame(readyFrame);
      readyFrame = undefined;
    }
    if (filterRenderDebounceTimeout !== undefined) {
      clearTimeout(filterRenderDebounceTimeout);
      filterRenderDebounceTimeout = undefined;
    }
    if (tileUpdateFrame !== undefined) {
      cancelAnimationFrame(tileUpdateFrame);
      tileUpdateFrame = undefined;
    }
    const previousLoadingTask = loadingTask;
    loadingTask = undefined;
    pdfDocument = undefined;
    await previousLoadingTask?.destroy().catch(() => undefined);
    await pdfFixedLayoutReader.release().catch(() => undefined);

    try {
      const loaded = await pdfFixedLayoutReader.load();

      if (!loaded) {
        return;
      }

      const { document, pages: nextPages, outline: rawOutline } = loaded;

      if (destroyed || generation !== loadGeneration) {
        await pdfFixedLayoutReader.release();
        return;
      }

      pdfDocument = document;
      for (const page of nextPages) {
        const cachedPage = pdfAdapter.getCachedPage(document, page.pageNumber);
        if (cachedPage) {
          pageCache.set(page.pageNumber, cachedPage);
        }
      }

      setOutlineEntries(mapPdfOutline(rawOutline));
      setOutlineLoaded(true);
      setPages(nextPages);
      pdfAdapter.setSearchDocument(document);
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
    const nextChain =
      getFixedLayoutReaderFilterChainPreference(storageKey) ?? defaultPdfFilterChain();

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
    setPageWidthOverflow(getFixedLayoutReaderPageWidthOverflowPreference(storageKey));
    restoreHorizontalScrollPositionIfNeeded();
  });

  createEffect(() => {
    const storageKey = props.bookId ?? props.fileUrl;

    if (storageKey === horizontalScrollPositionPreferenceStorageKey) {
      return;
    }

    horizontalScrollPositionPreferenceStorageKey = storageKey;
    setHorizontalScrollPosition(getFixedLayoutReaderHorizontalScrollPositionPreference(storageKey));
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
    void pages();
    void visiblePages();
    void documentWidth();
    void pageWidth();
    void isFitWidth();
    scheduleTileUpdate();
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

    void pdfFixedLayoutReader
      .navigate({ destination: node.dest, pageWidth: pageWidth() })
      .then((location) => {
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

    pdfAdapter.clearSearch();
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
    void pdfFixedLayoutReader.search({ query, direction, isContinuation });
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
    updatePageWidthOverflow(defaultFixedLayoutPageWidthOverflow);
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
      scheduleTileUpdate();
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

    if (tileUpdateFrame !== undefined) {
      cancelAnimationFrame(tileUpdateFrame);
    }

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    if (horizontalScrollRestoreFrame !== undefined) {
      cancelAnimationFrame(horizontalScrollRestoreFrame);
    }

    releaseTiles();
    cancelTextLayerTasks();
    destroyFilterRenderers();
    tileLayerRefs.clear();
    textLayerRefs.clear();
    textLayerTasks.clear();
    textLayerKeys.clear();
    void loadingTask?.destroy().catch(() => undefined);
    void pdfFixedLayoutReader.release().catch(() => undefined);
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

      <FixedLayoutFilterPanel
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
                style={{
                  width: `${Math.round(pageWidth())}px`,
                  'max-width': pageWidthOverflow() > 0 ? 'none' : '100%',
                  'aspect-ratio': `${page.width} / ${page.height}`,
                }}
                aria-label={`${t('page')} ${page.pageNumber}`}
              >
                <div
                  ref={(element) => {
                    tileLayerRefs.set(page.pageNumber, element);
                  }}
                  class={styles.tileLayer}
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
