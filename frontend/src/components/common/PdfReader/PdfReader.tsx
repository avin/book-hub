import type {
  PdfDocumentObject,
  PdfPageObject,
  PdfTextRectObject,
  SearchResult,
} from '@embedpdf/models';
import { PdfErrorCode } from '@embedpdf/models';
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
import {
  createPdfPageRenderPlan,
  limitPdfRenderTiles,
  pdfMaxActivePixels,
  type PdfRenderTile,
} from './pdfRenderPlan';
import { createPdfRenderScheduler } from './pdfRenderScheduler';
import styles from './PdfReader.module.scss';

type PdfPageDescriptor = {
  pageNumber: number;
  width: number;
  height: number;
};

type ScrollAnchor = {
  pageNumber: number;
  offsetRatio: number;
};

type PdfTileSurface = {
  tile: PdfRenderTile;
  wrapper: HTMLDivElement;
  sourceCanvas: HTMLCanvasElement;
  filteredCanvas?: HTMLCanvasElement;
  rendered: boolean;
  filterKey?: string;
};

const maxRenderPixelRatio = 2;
const documentPaddingX = 20;
const minPageWidth = 240;
const minPageHalfWidth = 120;
const guideOutsideMargin = 12;
const resizeAnchorHoldMs = 180;
const horizontalScrollCenter = 0.5;
const horizontalScrollPositionTolerance = 0.01;

function renderPixelRatio() {
  return Math.min(maxRenderPixelRatio, Math.max(1, window.devicePixelRatio || 1));
}

function isRenderCancelled(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'TaskAbortedError' || error.name === 'RenderingCancelledException')
  );
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
  let pdfDocument: PdfDocumentObject | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let viewportRenderFrame: number | undefined;
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
  const rasterLayerRefs = new Map<number, HTMLDivElement>();
  const textLayerRefs = new Map<number, HTMLDivElement>();
  const searchLayerRefs = new Map<number, HTMLDivElement>();
  const pageCache = new Map<number, PdfPageObject>();
  const textRectCache = new Map<number, PdfTextRectObject[]>();
  const tileSurfaces = new Map<string, PdfTileSurface>();
  const renderScheduler = createPdfRenderScheduler();
  let viewportPlanKey = '';
  let filterRenderGeneration = 0;
  let filterRenderDebounceTimeout: number | undefined;
  let sharedFilterRenderQueue: Promise<void> = Promise.resolve();
  const filterRenderDebounceMs = 50;
  let searchResults: SearchResult[] = [];
  let selectedSearchIndex = -1;
  let searchGeneration = 0;
  const textLayerKeys = new Map<number, string>();
  const [pages, setPages] = createSignal<PdfPageDescriptor[]>([]);
  const [activePages, setActivePages] = createSignal<ReadonlySet<number>>(new Set());
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
  const [appliedFilterKeys, setAppliedFilterKeys] = createSignal<ReadonlyMap<number, string>>(
    new Map(),
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

  const pdfAdapter = createPdfFixedLayoutAdapter({
    fileUrl: () => props.fileUrl,
  });
  const pdfFixedLayoutReader = createFixedLayoutReader(pdfAdapter.adapter);

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
    viewportPlanKey = '';
    invalidateFilteredPages();
    textLayerKeys.clear();
    restoreHorizontalScrollPositionIfNeeded();
    scheduleViewportRender();
  };

  const destroyFilterRenderers = () => {
    destroySharedPdfWebglFilterRenderer();
  };

  const clearTileFilter = (surface: PdfTileSurface) => {
    surface.sourceCanvas.style.display = 'block';
    surface.filterKey = undefined;

    if (surface.filteredCanvas) {
      surface.filteredCanvas.width = 0;
      surface.filteredCanvas.height = 0;
      surface.filteredCanvas.remove();
      surface.filteredCanvas = undefined;
    }
  };

  const invalidateFilteredPages = () => {
    filterRenderGeneration += 1;

    for (const surface of tileSurfaces.values()) {
      clearTileFilter(surface);
    }

    setAppliedFilterKeys(new Map());
  };

  const releaseTileSurface = (surface: PdfTileSurface) => {
    surface.sourceCanvas.width = 0;
    surface.sourceCanvas.height = 0;
    if (surface.filteredCanvas) {
      surface.filteredCanvas.width = 0;
      surface.filteredCanvas.height = 0;
    }
    surface.wrapper.remove();
  };

  const releaseAllTileSurfaces = () => {
    for (const surface of tileSurfaces.values()) {
      releaseTileSurface(surface);
    }

    tileSurfaces.clear();
    setAppliedFilterKeys(new Map());
  };

  const runExclusiveFilterRender = async (action: () => void | Promise<void>) => {
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

    invalidateFilteredPages();

    if (allFiltersDisabled) {
      destroyFilterRenderers();
    }
  };

  const disablePdfFilters = () => {
    setFilterError('pdfFiltersUnavailable');
    invalidateFilteredPages();
    destroyFilterRenderers();
  };

  const applyFilterToTile = async (surface: PdfTileSurface) => {
    if (!surface.rendered || !filtersEnabled() || filterError()) {
      clearTileFilter(surface);
      return;
    }

    const currentFilterKey = filterKey();

    if (surface.filterKey === currentFilterKey) {
      return;
    }

    const filterGenerationAtStart = filterRenderGeneration;
    const filterChainAtStart = filterChain();

    await runExclusiveFilterRender(() => {
      if (
        destroyed ||
        !tileSurfaces.has(surface.tile.key) ||
        filterGenerationAtStart !== filterRenderGeneration ||
        surface.filterKey === currentFilterKey
      ) {
        return;
      }

      const filteredCanvas = surface.filteredCanvas ?? document.createElement('canvas');
      filteredCanvas.className = styles.filteredCanvas;
      filteredCanvas.style.left = surface.sourceCanvas.style.left;
      filteredCanvas.style.top = surface.sourceCanvas.style.top;
      filteredCanvas.style.width = surface.sourceCanvas.style.width;
      filteredCanvas.style.height = surface.sourceCanvas.style.height;

      if (!surface.filteredCanvas) {
        surface.filteredCanvas = filteredCanvas;
        surface.wrapper.append(filteredCanvas);
      }

      try {
        renderPdfPageFilter(surface.sourceCanvas, filteredCanvas, filterChainAtStart);

        if (
          destroyed ||
          !tileSurfaces.has(surface.tile.key) ||
          filterGenerationAtStart !== filterRenderGeneration
        ) {
          return;
        }

        surface.filterKey = currentFilterKey;
        surface.sourceCanvas.style.display = 'none';
        filteredCanvas.style.display = 'block';
        setAppliedFilterKeys((current) => {
          const next = new Map(current);
          next.set(surface.tile.pageNumber, currentFilterKey);
          return next;
        });
      } catch (error) {
        clearTileFilter(surface);

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
        for (const surface of tileSurfaces.values()) {
          void applyFilterToTile(surface);
        }
      });
    }, filterRenderDebounceMs);
  };

  const updateFilterChain = (update: (chain: PdfFilterChain) => PdfFilterChain) => {
    const nextChain = update(filterChain());

    setFilterChainState(nextChain);
    setFixedLayoutReaderFilterChainPreference(props.bookId ?? props.fileUrl, nextChain);
    scheduleVisiblePageFilterRender();
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
      viewportPlanKey = '';
      invalidateFilteredPages();
      textLayerKeys.clear();
    }

    setDocumentWidth(nextWidth);
    restoreHorizontalScrollPositionIfNeeded();
    scheduleViewportRender();
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
    viewportPlanKey = '';
    invalidateFilteredPages();
    textLayerKeys.clear();
    restoreHorizontalScrollPositionIfNeeded();
    scheduleViewportRender();
  };

  const createTileSurface = (tile: PdfRenderTile) => {
    const rasterLayer = rasterLayerRefs.get(tile.pageNumber);

    if (!rasterLayer) {
      return undefined;
    }

    const wrapper = document.createElement('div');
    wrapper.className = styles.rasterTile;
    wrapper.dataset.pdfRasterTile = '';
    wrapper.dataset.tileKey = tile.key;
    wrapper.style.left = `${tile.coreCssRect.origin.x}px`;
    wrapper.style.top = `${tile.coreCssRect.origin.y}px`;
    wrapper.style.width = `${tile.coreCssRect.size.width}px`;
    wrapper.style.height = `${tile.coreCssRect.size.height}px`;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.className = styles.sourceCanvas;
    sourceCanvas.dataset.rasterPageNumber = String(tile.pageNumber);
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    sourceCanvas.style.left = `${tile.renderCssRect.origin.x - tile.coreCssRect.origin.x}px`;
    sourceCanvas.style.top = `${tile.renderCssRect.origin.y - tile.coreCssRect.origin.y}px`;
    sourceCanvas.style.width = `${tile.renderCssRect.size.width}px`;
    sourceCanvas.style.height = `${tile.renderCssRect.size.height}px`;
    wrapper.append(sourceCanvas);
    rasterLayer.append(wrapper);

    const surface: PdfTileSurface = {
      tile,
      wrapper,
      sourceCanvas,
      rendered: false,
    };
    tileSurfaces.set(tile.key, surface);
    return surface;
  };

  const enqueueBitmapTile = (
    descriptor: PdfPageDescriptor,
    tile: PdfRenderTile,
    surface: PdfTileSurface,
  ) => {
    const currentDocument = pdfDocument;
    const page = pageCache.get(descriptor.pageNumber);

    if (!currentDocument || !page) {
      return;
    }

    const scale = tile.outputWidth / tile.pdfRect.size.width || 1;

    renderScheduler.enqueue({
      id: `bitmap:${tile.key}`,
      pageNumber: descriptor.pageNumber,
      kind: 'bitmap',
      priority: tile.priority,
      run: () => {
        const { task, promise } = pdfAdapter.renderPageRect(
          currentDocument,
          page,
          tile.pdfRect,
          scale,
        );

        return {
          promise,
          cancel: () =>
            task.abort({
              code: PdfErrorCode.Cancelled,
              message: 'PDF tile render cancelled',
            }),
        };
      },
      commit: (image) => {
        if (destroyed || tileSurfaces.get(tile.key) !== surface) {
          return;
        }

        const context = surface.sourceCanvas.getContext('2d');

        if (!context) {
          return;
        }

        surface.sourceCanvas.width = image.width;
        surface.sourceCanvas.height = image.height;
        context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        surface.rendered = true;
        void applyFilterToTile(surface);
      },
      onError: (error) => {
        if (!isRenderCancelled(error)) {
          console.error('Failed to render PDF tile', error);
          setFailed(true);
        }
      },
    });
  };

  const renderSearchHighlights = (pageNumber: number) => {
    const layer = searchLayerRefs.get(pageNumber);
    const descriptor = pages().find((page) => page.pageNumber === pageNumber);

    if (!layer || !descriptor) {
      return;
    }

    const highlights: HTMLElement[] = [];

    searchResults.forEach((result, resultIndex) => {
      if (result.pageIndex !== pageNumber - 1) {
        return;
      }

      for (const rect of result.rects) {
        const highlight = document.createElement('span');
        highlight.className = styles.searchHighlight;
        highlight.classList.toggle(
          styles.searchHighlightSelected,
          resultIndex === selectedSearchIndex,
        );
        highlight.dataset.searchResultIndex = String(resultIndex);
        highlight.style.left = `${(rect.origin.x / descriptor.width) * 100}%`;
        highlight.style.top = `${(rect.origin.y / descriptor.height) * 100}%`;
        highlight.style.width = `${(rect.size.width / descriptor.width) * 100}%`;
        highlight.style.height = `${(rect.size.height / descriptor.height) * 100}%`;
        highlights.push(highlight);
      }
    });

    layer.replaceChildren(...highlights);
  };

  const enqueueTextLayer = (descriptor: PdfPageDescriptor) => {
    const generation = loadGeneration;
    const layer = textLayerRefs.get(descriptor.pageNumber);
    const pageElement = pageRefs.get(descriptor.pageNumber);
    const currentDocument = pdfDocument;
    const page = pageCache.get(descriptor.pageNumber);

    if (!layer || !pageElement || !currentDocument || !page) {
      return;
    }

    const displayWidth = Math.round(pageElement.clientWidth);

    if (displayWidth <= 0) {
      return;
    }

    const displayHeight = Math.round(displayWidth * (descriptor.height / descriptor.width));
    const renderKey = `${displayWidth}`;

    if (textLayerKeys.get(descriptor.pageNumber) === renderKey) {
      return;
    }

    const scale = displayWidth / descriptor.width;
    layer.style.width = `${displayWidth}px`;
    layer.style.height = `${displayHeight}px`;
    const mountTextRects = (textRects: PdfTextRectObject[]) => {
      const fragments = textRects.map((textRect: PdfTextRectObject) => {
        const span = document.createElement('span');
        span.textContent = textRect.content;
        span.style.left = `${textRect.rect.origin.x * scale}px`;
        span.style.top = `${textRect.rect.origin.y * scale}px`;
        span.style.width = `${textRect.rect.size.width * scale}px`;
        span.style.height = `${textRect.rect.size.height * scale}px`;
        span.style.fontFamily = textRect.font.family;
        span.style.fontSize = `${textRect.font.size * scale}px`;
        span.style.lineHeight = `${textRect.rect.size.height * scale}px`;
        return span;
      });

      layer.replaceChildren(...fragments);
      textLayerKeys.set(descriptor.pageNumber, renderKey);
      renderSearchHighlights(descriptor.pageNumber);
    };
    const cachedTextRects = textRectCache.get(descriptor.pageNumber);

    if (cachedTextRects) {
      mountTextRects(cachedTextRects);
      return;
    }

    renderScheduler.enqueue({
      id: `text:${descriptor.pageNumber}:${renderKey}`,
      pageNumber: descriptor.pageNumber,
      kind: 'text',
      priority: 100,
      run: () => {
        const { task, promise } = pdfAdapter.getPageText(currentDocument, page);

        return {
          promise,
          cancel: () =>
            task.abort({
              code: PdfErrorCode.Cancelled,
              message: 'PDF text layer render cancelled',
            }),
        };
      },
      commit: (textRects) => {
        if (
          destroyed ||
          generation !== loadGeneration ||
          !activePages().has(descriptor.pageNumber)
        ) {
          return;
        }

        textRectCache.set(descriptor.pageNumber, textRects);
        mountTextRects(textRects);
      },
      onError: (error) => {
        if (!isRenderCancelled(error)) {
          console.error('Failed to render PDF text layer', error);
        }
      },
    });
  };

  const updateViewportRenderPlan = () => {
    const currentPages = pages();

    if (destroyed || !pdfDocument || currentPages.length === 0) {
      return;
    }

    const ratio = renderPixelRatio();
    const plannedTiles: PdfRenderTile[] = [];

    for (const descriptor of currentPages) {
      const pageElement = pageRefs.get(descriptor.pageNumber);

      if (!pageElement) {
        continue;
      }

      const rect = pageElement.getBoundingClientRect();
      const displayWidth = pageElement.clientWidth;
      const displayHeight = pageElement.clientHeight;

      if (displayWidth <= 0 || displayHeight <= 0) {
        continue;
      }

      plannedTiles.push(
        ...createPdfPageRenderPlan({
          pageNumber: descriptor.pageNumber,
          pdfWidth: descriptor.width,
          pdfHeight: descriptor.height,
          displayWidth,
          displayHeight,
          pageViewportRect: {
            origin: { x: rect.left, y: rect.top },
            size: { width: rect.width, height: rect.height },
          },
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          pixelRatio: ratio,
        }).tiles,
      );
    }

    const tiles = limitPdfRenderTiles(plannedTiles, pdfMaxActivePixels);
    const nextPlanKey = tiles.map((tile) => tile.key).join('|');

    if (nextPlanKey === viewportPlanKey) {
      return;
    }

    viewportPlanKey = nextPlanKey;
    renderScheduler.beginGeneration();
    const requiredKeys = new Set(tiles.map((tile) => tile.key));
    const nextActivePages = new Set(tiles.map((tile) => tile.pageNumber));

    for (const [key, surface] of tileSurfaces) {
      if (!requiredKeys.has(key)) {
        releaseTileSurface(surface);
        tileSurfaces.delete(key);
      }
    }

    for (const descriptor of currentPages) {
      if (nextActivePages.has(descriptor.pageNumber)) {
        continue;
      }

      textLayerRefs.get(descriptor.pageNumber)?.replaceChildren();
      searchLayerRefs.get(descriptor.pageNumber)?.replaceChildren();
      textLayerKeys.delete(descriptor.pageNumber);
    }

    setActivePages(nextActivePages);
    setAppliedFilterKeys((current) => {
      const next = new Map<number, string>();
      for (const [pageNumber, key] of current) {
        if (nextActivePages.has(pageNumber)) {
          next.set(pageNumber, key);
        }
      }
      return next;
    });

    for (const tile of tiles) {
      const descriptor = currentPages[tile.pageNumber - 1];

      if (!descriptor) {
        continue;
      }

      const surface = tileSurfaces.get(tile.key) ?? createTileSurface(tile);

      if (!surface) {
        continue;
      }

      if (surface.rendered) {
        renderScheduler.markBitmapReady(tile.pageNumber);
        void applyFilterToTile(surface);
      } else {
        enqueueBitmapTile(descriptor, tile, surface);
      }
    }

    for (const pageNumber of nextActivePages) {
      const descriptor = currentPages[pageNumber - 1];
      if (descriptor) {
        enqueueTextLayer(descriptor);
      }
    }
  };

  const scheduleViewportRender = () => {
    if (viewportRenderFrame !== undefined) {
      return;
    }

    viewportRenderFrame = requestAnimationFrame(() => {
      viewportRenderFrame = undefined;
      updateViewportRenderPlan();
    });
  };

  const loadDocument = async () => {
    const generation = loadGeneration + 1;

    loadGeneration = generation;
    executedSearchQuery = undefined;
    searchResults = [];
    selectedSearchIndex = -1;
    searchGeneration += 1;
    setSearchCount(undefined);
    setLoading(true);
    setFailed(false);
    setPages([]);
    setActivePages(new Set<number>());
    setOutlineEntries([]);
    setOutlineLoaded(false);
    setTocOpen(false);
    renderScheduler.beginGeneration();
    releaseAllTileSurfaces();
    viewportPlanKey = '';
    pageRefs.clear();
    rasterLayerRefs.clear();
    textLayerRefs.clear();
    searchLayerRefs.clear();
    pageCache.clear();
    textRectCache.clear();
    invalidateFilteredPages();
    textLayerKeys.clear();
    destroyFilterRenderers();
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
    pdfDocument = undefined;
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
      for (const page of document.pages) {
        pageCache.set(page.index + 1, page);
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
        restoreHorizontalScrollPositionIfNeeded();
        scheduleViewportRender();
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
    void documentWidth();
    void pageWidth();
    void isFitWidth();
    viewportPlanKey = '';
    scheduleViewportRender();
  });

  createEffect(() => {
    if (!isFitWidth()) {
      return;
    }

    measureDocument();
    textLayerKeys.clear();
    viewportPlanKey = '';
    scheduleViewportRender();
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

    void pdfFixedLayoutReader.navigate({ destination: node.destination }).then((location) => {
      if (!location) {
        return;
      }

      readerNavigationHistory.recordNavigation(location, previousLocation);
      scrollToPdfAnchor(location);
    });
  };

  type SearchDirection = 'next' | 'previous';

  const clearSearchHighlights = () => {
    searchGeneration += 1;
    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
      searchScrollFrame = undefined;
    }

    searchResults = [];
    selectedSearchIndex = -1;
    for (const layer of searchLayerRefs.values()) {
      layer.replaceChildren();
    }
    setSearchCount(undefined);
    executedSearchQuery = undefined;
  };

  const selectSearchResult = (direction: SearchDirection, reset: boolean) => {
    if (searchResults.length === 0) {
      selectedSearchIndex = -1;
      setSearchCount(undefined);
      return;
    }

    if (reset) {
      selectedSearchIndex = direction === 'previous' ? searchResults.length - 1 : 0;
    } else {
      const delta = direction === 'previous' ? -1 : 1;
      selectedSearchIndex =
        (selectedSearchIndex + delta + searchResults.length) % searchResults.length;
    }

    setSearchCount({ current: selectedSearchIndex + 1, total: searchResults.length });
    for (const page of pages()) {
      renderSearchHighlights(page.pageNumber);
    }

    const result = searchResults[selectedSearchIndex];
    goToPage(String(result.pageIndex + 1));

    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
    }
    searchScrollFrame = requestAnimationFrame(() => {
      searchScrollFrame = undefined;
      const highlight = searchLayerRefs
        .get(result.pageIndex + 1)
        ?.querySelector<HTMLElement>(`[data-search-result-index="${selectedSearchIndex}"]`);
      highlight?.scrollIntoView({ behavior: 'instant', block: 'center' });
      syncCurrentPage();
    });
  };

  const search = (direction: SearchDirection) => {
    const query = searchValue().trim();

    if (!query) {
      clearSearchHighlights();
      return;
    }

    if (executedSearchQuery === query) {
      selectSearchResult(direction, false);
      return;
    }

    executedSearchQuery = query;
    const generation = ++searchGeneration;
    void pdfFixedLayoutReader.search({ query }).then((result) => {
      if (!result || generation !== searchGeneration || executedSearchQuery !== query) {
        return;
      }

      untrack(() => {
        searchResults = result.results;
        selectSearchResult(direction, true);
      });
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
      syncCurrentPage();
      rememberHorizontalScrollPosition();
      readerNavigationHistory.updateCurrentLocation();
      scheduleViewportRender();
    };
    const onResize = () => {
      handleViewportResize();
      scheduleViewportRender();
    };

    resizeObserver = new ResizeObserver(() => {
      handleViewportResize();
      scheduleViewportRender();
    });

    if (rootRef) {
      resizeObserver.observe(rootRef);
    }

    measureDocument();
    scheduleViewportRender();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    onCleanup(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
    });
  });

  onCleanup(() => {
    destroyed = true;

    if (viewportRenderFrame !== undefined) {
      cancelAnimationFrame(viewportRenderFrame);
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

    renderScheduler.release();
    releaseAllTileSurfaces();
    destroyFilterRenderers();
    rasterLayerRefs.clear();
    textLayerRefs.clear();
    searchLayerRefs.clear();
    textRectCache.clear();
    textLayerKeys.clear();
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
                data-applied-filter-key={appliedFilterKeys().get(page.pageNumber) ?? ''}
                style={{
                  width: `${Math.round(pageWidth())}px`,
                  'max-width': pageWidthOverflow() > 0 ? 'none' : '100%',
                  'aspect-ratio': `${page.width} / ${page.height}`,
                }}
                aria-label={`${t('page')} ${page.pageNumber}`}
              >
                <div
                  class={styles.rasterLayer}
                  ref={(element) => {
                    rasterLayerRefs.set(page.pageNumber, element);
                  }}
                  aria-hidden="true"
                />
                <div
                  ref={(element) => {
                    searchLayerRefs.set(page.pageNumber, element);
                  }}
                  class={styles.searchLayer}
                  aria-hidden="true"
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
