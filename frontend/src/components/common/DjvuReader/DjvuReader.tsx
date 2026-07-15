import { ListTree, SlidersHorizontal } from 'lucide-solid';
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
import {
  createDjVuWorker,
  type DjVuContentsEntry,
  type DjVuTextZone,
  type DjVuWorker,
} from '@/api/djvujs';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
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
import useReaderChrome from '../ReaderChrome/useReaderChrome';
import PdfFilterPanel from '../PdfReader/PdfFilterPanel/PdfFilterPanel';
import {
  defaultPdfFilterChain,
  grayscaleFilterFromChain,
  hasEnabledPdfFilters,
  invertFilterFromChain,
  softTextEnhancementFilterFromChain,
  textEnhancementFilterFromChain,
  visualAdjustmentFilterFromChain,
  warmthFilterFromChain,
  type PdfFilterChain,
} from '../PdfReader/pdfFilters';
import {
  clampPdfPageWidthOverflow,
  defaultPdfPageWidthOverflow,
} from '../PdfReader/pdfPageSettings';
import {
  destroySharedPdfWebglFilterRenderer,
  isPdfWebglAvailable,
  isRecoverablePdfFilterError,
  renderPdfPageFilter,
} from '../PdfReader/pdfWebglFilter';
import styles from '../PdfReader/PdfReader.module.scss';

type Page = { pageNumber: number; width: number; height: number };
type SearchMatch = {
  pageNumber: number;
  segments: { zoneIndex: number; start: number; length: number }[];
};
type ScrollAnchor = { pageNumber: number; offsetRatio: number };

const documentPaddingX = 20;
const minPageWidth = 240;
const minPageHalfWidth = 120;
const maxPixelRatio = 2;
const guideOutsideMargin = 12;
const horizontalScrollCenter = 0.5;
const horizontalScrollPositionTolerance = 0.01;
const renderAfterScrollDelayMs = 80;
const releasedPageBuffer = 5;

function renderPixelRatio() {
  return Math.min(maxPixelRatio, Math.max(1, window.devicePixelRatio || 1));
}

function DjvuReader(props: {
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
  let worker: DjVuWorker | undefined;
  let observer: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let destroyed = false;
  let generation = 0;
  let renderQueue: Page[] = [];
  let renderInProgress = false;
  let renderAfterScrollTimeout: number | undefined;
  let horizontalScrollRestoreFrame: number | undefined;
  let horizontalScrollRestoreGeneration = 0;
  let horizontalScrollRestorePending = false;
  let lastHorizontalScrollLeft = 0;
  let lastHorizontalScrollMaxLeft = 0;
  let lastScrollAnchor: ScrollAnchor | undefined;
  let widthScrollAnchor: ScrollAnchor | undefined;
  let widthScrollAnchorFrame: number | undefined;
  let widthUpdatePending = false;
  let overflowScrollAnchor: ScrollAnchor | undefined;
  let overflowScrollAnchorFrame: number | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchorFrame: number | undefined;
  let searchScrollFrame: number | undefined;
  let searchGeneration = 0;
  let executedSearchQuery: string | undefined;
  const pageRefs = new Map<number, HTMLElement>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();
  const filteredCanvasRefs = new Map<number, HTMLCanvasElement>();
  const textLayerRefs = new Map<number, HTMLDivElement>();
  const textByPage = new Map<number, DjVuTextZone[]>();
  const renderedKeys = new Map<number, string>();
  const allocatedCanvasPages = new Set<number>();
  const tocTargets = new Map<TocEntry, string>();
  const [pages, setPages] = createSignal<Page[]>([]);
  const [visiblePages, setVisiblePages] = createSignal<ReadonlySet<number>>(new Set());
  const [documentWidth, setDocumentWidth] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [tocOpen, setTocOpen] = createSignal(false);
  const [filterPanelOpen, setFilterPanelOpen] = createSignal(false);
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageInput, setPageInput] = createSignal('1');
  const [searchValue, setSearchValue] = createSignal('');
  const [searchMatches, setSearchMatches] = createSignal<SearchMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = createSignal(-1);
  const [outline, setOutline] = createSignal<TocEntry[]>([]);
  const [outlineLoaded, setOutlineLoaded] = createSignal(false);
  const [maxWidth, setMaxWidth] = createSignal<number | undefined>(
    getFixedLayoutReaderContentWidthPreference(),
  );
  const [overflow, setOverflow] = createSignal(
    untrack(() => getFixedLayoutReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl)),
  );
  const [filterChain, setFilterChain] = createSignal<PdfFilterChain>(
    untrack(
      () =>
        getFixedLayoutReaderFilterChainPreference(props.bookId ?? props.fileUrl) ??
        defaultPdfFilterChain(),
    ),
  );
  const [filterError, setFilterError] = createSignal<string>();
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number>();
  const [horizontalScrollPosition, setHorizontalScrollPosition] = createSignal<number | undefined>(
    untrack(() =>
      getFixedLayoutReaderHorizontalScrollPositionPreference(props.bookId ?? props.fileUrl),
    ),
  );
  const [rulerElement, setRulerElement] = createSignal<HTMLDivElement>();

  const availableWidth = createMemo(() => Math.max(minPageWidth, documentWidth()));
  const baseWidth = createMemo(() => {
    const width = maxWidth();
    return width === undefined
      ? availableWidth()
      : Math.min(availableWidth(), Math.max(minPageWidth, width));
  });
  const pageWidth = createMemo(() => Math.round(baseWidth() * (1 + overflow() / 100)));
  const isFitWidth = createMemo(() => maxWidth() === undefined);
  const filtersEnabled = createMemo(() => hasEnabledPdfFilters(filterChain()));
  const textEnhancement = createMemo(() => textEnhancementFilterFromChain(filterChain()));
  const softTextEnhancement = createMemo(() => softTextEnhancementFilterFromChain(filterChain()));
  const invert = createMemo(() => invertFilterFromChain(filterChain()));
  const visualAdjustment = createMemo(() => visualAdjustmentFilterFromChain(filterChain()));
  const warmth = createMemo(() => warmthFilterFromChain(filterChain()));
  const grayscale = createMemo(() => grayscaleFilterFromChain(filterChain()));
  const markerStyles = createMemo(() =>
    computeWidthRulerMarkers(rulerElement(), maxWidth(), availableWidth(), minPageHalfWidth),
  );
  const searchCount = createMemo(() => {
    const total = searchMatches().length;
    return { current: total ? selectedMatch() + 1 : 0, total };
  });

  const pageHeight = (page: Page) => Math.round(pageWidth() * (page.height / page.width));

  const resetToFitWidth = () => {
    updateWidth(undefined);
    commitWidthUpdate();
  };

  const handleRulerPointer = (event: PointerEvent) => {
    const ruler = rulerElement();
    if (!ruler || !rootRef) return;

    const rulerRect = ruler.getBoundingClientRect();
    const rootRect = rootRef.getBoundingClientRect();
    const rulerCenter = rulerRect.left + rulerRect.width / 2;
    const pageCenter = rootRect.left + rootRect.width / 2;
    const halfWidth = clampWidth(
      Math.abs(event.clientX - rulerCenter),
      minPageHalfWidth,
      rulerRect.width / 2,
    );
    const width = halfWidth * 2;
    const outsideGuides =
      event.clientX < pageCenter - width / 2 - guideOutsideMargin ||
      event.clientX > pageCenter + width / 2 + guideOutsideMargin;

    if (outsideGuides) {
      updateWidth(undefined);
      setGuideX(event.clientX);
      return;
    }

    setGuideX(rulerCenter + (event.clientX < rulerCenter ? -1 : 1) * halfWidth);
    updateWidth(Math.round(width));
  };

  const measure = () => {
    if (!rootRef) return;
    const nextWidth = Math.round(rootRef.clientWidth - documentPaddingX * 2);

    if (nextWidth === documentWidth()) return;

    resizeScrollAnchor ??= lastScrollAnchor ?? captureScrollAnchor();
    setDocumentWidth(nextWidth);

    if (resizeScrollAnchorFrame !== undefined) {
      cancelAnimationFrame(resizeScrollAnchorFrame);
    }
    resizeScrollAnchorFrame = requestAnimationFrame(() => {
      resizeScrollAnchorFrame = undefined;
      const anchor = resizeScrollAnchor;
      resizeScrollAnchor = undefined;
      if (anchor) scrollToAnchor(anchor);
      restoreHorizontalScrollPositionIfNeeded();
    });
  };

  const preferenceKey = () => props.bookId ?? props.fileUrl;

  const captureScrollAnchor = (): ScrollAnchor | undefined => {
    const pageList = pages();
    let lowerBound = 0;
    let upperBound = pageList.length - 1;
    let anchorPage: Page | undefined;
    let anchorElement: HTMLElement | undefined;

    while (lowerBound <= upperBound) {
      const index = Math.floor((lowerBound + upperBound) / 2);
      const page = pageList[index];
      const element = pageRefs.get(page.pageNumber);
      if (!element || element.offsetHeight <= 0) return undefined;

      const top = element.getBoundingClientRect().top + window.scrollY;
      if (top > window.scrollY + 0.5) {
        upperBound = index - 1;
        continue;
      }

      anchorPage = page;
      anchorElement = element;
      lowerBound = index + 1;
    }

    if (!anchorPage || !anchorElement) {
      const firstPage = pageList[0];
      return firstPage ? { pageNumber: firstPage.pageNumber, offsetRatio: 0 } : undefined;
    }

    const top = anchorElement.getBoundingClientRect().top + window.scrollY;
    return {
      pageNumber: anchorPage.pageNumber,
      offsetRatio: Math.min(1, Math.max(0, (window.scrollY - top) / anchorElement.offsetHeight)),
    };
  };

  const scrollToAnchor = (anchor: ScrollAnchor) => {
    const element = pageRefs.get(anchor.pageNumber);
    if (!element) return;

    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: Math.max(0, top + element.offsetHeight * Math.min(1, Math.max(0, anchor.offsetRatio))),
      behavior: 'instant',
    });
    setCurrentPage(anchor.pageNumber);
    setPageInput(String(anchor.pageNumber));
    lastScrollAnchor = anchor;
  };

  const restoreHorizontalScrollPositionIfNeeded = () => {
    if (horizontalScrollRestoreFrame !== undefined) {
      cancelAnimationFrame(horizontalScrollRestoreFrame);
    }

    const restoreGeneration = ++horizontalScrollRestoreGeneration;
    horizontalScrollRestorePending = true;
    horizontalScrollRestoreFrame = requestAnimationFrame(() => {
      horizontalScrollRestoreFrame = undefined;
      if (restoreGeneration !== horizontalScrollRestoreGeneration) return;

      const scrollingElement = document.scrollingElement;
      if (scrollingElement) {
        const maxScrollLeft = scrollingElement.scrollWidth - scrollingElement.clientWidth;
        const position = horizontalScrollPosition() ?? horizontalScrollCenter;
        const scrollLeft = maxScrollLeft > 0 ? maxScrollLeft * position : 0;
        scrollingElement.scrollLeft = scrollLeft;
        lastHorizontalScrollLeft = scrollLeft;
        lastHorizontalScrollMaxLeft = maxScrollLeft;
      }

      requestAnimationFrame(() => {
        if (restoreGeneration === horizontalScrollRestoreGeneration) {
          horizontalScrollRestorePending = false;
        }
      });
    });
  };

  const rememberHorizontalScrollPosition = () => {
    if (horizontalScrollRestorePending) return;

    const scrollingElement = document.scrollingElement;
    if (!scrollingElement) return;

    const maxScrollLeft = scrollingElement.scrollWidth - scrollingElement.clientWidth;
    const scrollLeft = scrollingElement.scrollLeft;
    if (
      maxScrollLeft === lastHorizontalScrollMaxLeft &&
      Math.abs(scrollLeft - lastHorizontalScrollLeft) < 0.5
    )
      return;

    lastHorizontalScrollLeft = scrollLeft;
    lastHorizontalScrollMaxLeft = maxScrollLeft;
    if (maxScrollLeft <= 0) return;

    const position = scrollLeft / maxScrollLeft;
    const nextPosition =
      scrollLeft <= 1 ||
      Math.abs(position - horizontalScrollCenter) <= horizontalScrollPositionTolerance
        ? undefined
        : position;
    const savedPosition = horizontalScrollPosition();
    if (
      nextPosition === savedPosition ||
      (nextPosition !== undefined &&
        savedPosition !== undefined &&
        Math.abs(nextPosition - savedPosition) < horizontalScrollPositionTolerance)
    )
      return;

    setHorizontalScrollPosition(nextPosition);
    setFixedLayoutReaderHorizontalScrollPositionPreference(preferenceKey(), nextPosition);
  };

  const renderTextLayer = (pageNumber: number) => {
    const layer = textLayerRefs.get(pageNumber);
    const page = pages().find((item) => item.pageNumber === pageNumber);
    const pageElement = pageRefs.get(pageNumber);
    const zones = textByPage.get(pageNumber);

    if (!layer || !page || !pageElement || !zones) return;

    const selected = searchMatches()[selectedMatch()];
    layer.textContent = '';

    zones.forEach((zone, zoneIndex) => {
      if (!zone.text) return;
      const span = document.createElement('span');
      span.style.left = `${(zone.x / page.width) * 100}%`;
      span.style.top = `${((page.height - zone.y - zone.height) / page.height) * 100}%`;
      span.style.fontSize = `${Math.max(1, (zone.height / page.height) * pageHeight(page))}px`;
      span.dataset.textZoneWidth = String(zone.width / page.width);

      const zoneMatches = searchMatches()
        .flatMap((match, matchIndex) =>
          (match.pageNumber === pageNumber ? match.segments : [])
            .filter((segment) => segment.zoneIndex === zoneIndex)
            .map((segment) => ({ ...segment, matchIndex, selected: selected === match })),
        )
        .sort((first, second) => first.start - second.start);
      let textOffset = 0;
      for (const match of zoneMatches) {
        span.append(document.createTextNode(zone.text.slice(textOffset, match.start)));

        const highlight = document.createElement('mark');
        highlight.className = `highlight${match.selected ? ' selected' : ''}`;
        highlight.dataset.searchMatchIndex = String(match.matchIndex);
        highlight.textContent = zone.text.slice(match.start, match.start + match.length);
        span.append(highlight);
        textOffset = match.start + match.length;
      }
      span.append(document.createTextNode(zone.text.slice(textOffset)));
      layer.append(span);

      const range = document.createRange();
      range.selectNodeContents(span);
      const renderedWidth = range.getBoundingClientRect().width;
      const targetWidth = Number(span.dataset.textZoneWidth) * pageElement.clientWidth;

      if (renderedWidth > 0 && targetWidth > 0) {
        span.style.transform = `scaleX(${targetWidth / renderedWidth})`;
      }
    });
  };

  const isPageRenderRelevant = (page: Page, activeWorker: DjVuWorker) =>
    !destroyed && activeWorker === worker && visiblePages().has(page.pageNumber);

  const renderPage = async (page: Page) => {
    const activeWorker = worker;
    const canvas = canvasRefs.get(page.pageNumber);
    const pageElement = pageRefs.get(page.pageNumber);

    if (!activeWorker || !canvas || !pageElement || !isPageRenderRelevant(page, activeWorker))
      return;
    const width = Math.round(pageElement.clientWidth);
    const key = `${width}:${renderPixelRatio()}`;

    if (renderedKeys.get(page.pageNumber) !== key) {
      const pageImage = await activeWorker.doc.getPage(page.pageNumber).createPngObjectUrl().run();
      try {
        if (!isPageRenderRelevant(page, activeWorker)) return;
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const nextImage = new Image();
          nextImage.onload = () => resolve(nextImage);
          nextImage.onerror = () => reject(new Error('DJVU page image could not be decoded'));
          nextImage.src = pageImage.url;
        });
        if (!isPageRenderRelevant(page, activeWorker)) return;
        const ratio = renderPixelRatio();
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(canvas.width * (page.height / page.width)));
        allocatedCanvasPages.add(page.pageNumber);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        renderedKeys.set(page.pageNumber, key);
        restoreHorizontalScrollPositionIfNeeded();
      } finally {
        activeWorker.revokeObjectURL(pageImage.url);
      }
    }

    if (!isPageRenderRelevant(page, activeWorker)) return;

    const filteredCanvas = filteredCanvasRefs.get(page.pageNumber);
    if (filtersEnabled() && filteredCanvas) {
      try {
        renderPdfPageFilter(canvas, filteredCanvas, filterChain());
        filteredCanvas.style.width = canvas.style.width;
        filteredCanvas.style.height = canvas.style.height;
        filteredCanvas.classList.add(styles.filteredCanvasVisible);
      } catch (error) {
        if (isRecoverablePdfFilterError(error)) {
          destroySharedPdfWebglFilterRenderer();
          refreshVisiblePages();
          return;
        }

        console.error('Failed to apply DJVU page filter', error);
        setFilterError('pdfFiltersUnavailable');
      }
    } else if (filteredCanvas) {
      filteredCanvas.classList.remove(styles.filteredCanvasVisible);
    }

    if (!isPageRenderRelevant(page, activeWorker)) return;

    if (!textByPage.has(page.pageNumber)) {
      const zones =
        (await activeWorker.doc.getPage(page.pageNumber).getNormalizedTextZones().run()) ?? [];
      if (isPageRenderRelevant(page, activeWorker)) textByPage.set(page.pageNumber, zones);
    }
    if (isPageRenderRelevant(page, activeWorker)) renderTextLayer(page.pageNumber);
  };

  const renderPageDistanceFromViewportCenter = (page: Page) => {
    const rect = pageRefs.get(page.pageNumber)?.getBoundingClientRect();
    if (!rect) return Number.POSITIVE_INFINITY;

    return Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
  };

  const runNextRenderTask = () => {
    if (renderInProgress) return;

    const page = renderQueue.shift();
    if (!page) return;

    const taskGeneration = generation;
    renderInProgress = true;
    void renderPage(page)
      .catch((error) => {
        if (!destroyed && taskGeneration === generation) {
          console.error('Could not render DJVU page', error);
        }
      })
      .finally(() => {
        if (taskGeneration !== generation) return;
        renderInProgress = false;
        scheduleNextRenderTask();
      });
  };

  const scheduleNextRenderTask = () => {
    if (renderAfterScrollTimeout === undefined) runNextRenderTask();
  };

  const deferRenderingUntilScrollSettles = () => {
    if (renderAfterScrollTimeout !== undefined) clearTimeout(renderAfterScrollTimeout);

    renderAfterScrollTimeout = window.setTimeout(() => {
      renderAfterScrollTimeout = undefined;
      untrack(runNextRenderTask);
    }, renderAfterScrollDelayMs);
  };

  const scheduleVisiblePageRendering = () => {
    const currentVisiblePages = visiblePages();
    renderQueue = pages()
      .filter((page) => currentVisiblePages.has(page.pageNumber))
      .sort(
        (left, right) =>
          renderPageDistanceFromViewportCenter(left) -
            renderPageDistanceFromViewportCenter(right) || left.pageNumber - right.pageNumber,
      );
    scheduleNextRenderTask();
  };

  const refreshVisiblePages = () => {
    renderedKeys.clear();
    scheduleVisiblePageRendering();
  };

  const releasePageResources = (pageNumber: number) => {
    renderQueue = renderQueue.filter((page) => page.pageNumber !== pageNumber);

    const canvas = canvasRefs.get(pageNumber);

    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }

    const filteredCanvas = filteredCanvasRefs.get(pageNumber);

    if (filteredCanvas) {
      filteredCanvas.width = 0;
      filteredCanvas.height = 0;
      filteredCanvas.classList.remove(styles.filteredCanvasVisible);
    }

    const textLayer = textLayerRefs.get(pageNumber);

    if (textLayer) {
      textLayer.textContent = '';
    }

    renderedKeys.delete(pageNumber);
    allocatedCanvasPages.delete(pageNumber);
  };

  const hasAllocatedPageResources = (pageNumber: number) =>
    renderedKeys.has(pageNumber) || allocatedCanvasPages.has(pageNumber);

  const loadDocument = async () => {
    const loadGeneration = ++generation;
    let nextWorker: DjVuWorker | undefined;
    renderQueue = [];
    renderInProgress = false;
    if (renderAfterScrollTimeout !== undefined) clearTimeout(renderAfterScrollTimeout);
    renderAfterScrollTimeout = undefined;
    worker?.worker.terminate();
    worker = undefined;
    setLoading(true);
    setFailed(false);
    setPages([]);
    setOutline([]);
    setOutlineLoaded(false);
    textByPage.clear();
    renderedKeys.clear();
    allocatedCanvasPages.clear();
    tocTargets.clear();
    lastScrollAnchor = undefined;
    try {
      nextWorker = await createDjVuWorker();
      const response = await fetch(props.fileUrl);
      if (!response.ok) throw new Error('Could not load DJVU');
      await nextWorker.createDocument(await response.arrayBuffer());
      if (!(await nextWorker.doc.isBundled().run()))
        throw new Error('Indirect DJVU is not supported');
      const sizes = await nextWorker.doc.getPagesSizes().run();
      const contents = await nextWorker.doc.getContents().run();
      if (loadGeneration !== generation || destroyed) {
        nextWorker.worker.terminate();
        return;
      }
      worker = nextWorker;
      const mapContents = (entries: DjVuContentsEntry[] | null): TocEntry[] =>
        (entries ?? []).map((entry) => {
          const tocEntry: TocEntry = {
            label: entry.description || t('page'),
            children: mapContents(entry.children ?? null),
          };
          tocTargets.set(tocEntry, entry.url);
          return tocEntry;
        });
      setPages(
        sizes.map((size, index) => ({
          pageNumber: index + 1,
          width: size.width,
          height: size.height,
        })),
      );
      setOutline(mapContents(contents));
      setOutlineLoaded(true);
      setLoading(false);
      requestAnimationFrame(restoreHorizontalScrollPositionIfNeeded);
      requestAnimationFrame(() => props.onReady?.());
    } catch (error) {
      console.error('Could not open DJVU', error);
      nextWorker?.worker.terminate();
      if (loadGeneration === generation && !destroyed) {
        setLoading(false);
        setFailed(true);
      }
    }
  };

  const clearSearchHighlights = () => {
    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
      searchScrollFrame = undefined;
    }

    searchGeneration += 1;
    executedSearchQuery = undefined;
    setSearchMatches([]);
    setSelectedMatch(-1);
    for (const page of pages()) renderTextLayer(page.pageNumber);
  };

  const scrollToSearchMatch = (match: SearchMatch | undefined) => {
    if (!match) return;

    if (searchScrollFrame !== undefined) cancelAnimationFrame(searchScrollFrame);
    searchScrollFrame = requestAnimationFrame(() => {
      searchScrollFrame = undefined;
      textLayerRefs
        .get(match.pageNumber)
        ?.querySelector<HTMLElement>('.highlight.selected')
        ?.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
  };

  const selectSearchMatch = (matches: SearchMatch[], nextIndex: number) => {
    const previousIndex = selectedMatch();
    const previous = matches[previousIndex];
    const next = matches[nextIndex];

    for (const pageNumber of new Set([previous?.pageNumber, next?.pageNumber])) {
      if (!pageNumber) continue;
      textLayerRefs
        .get(pageNumber)
        ?.querySelectorAll<HTMLElement>('.highlight.selected')
        .forEach((element) => element.classList.remove('selected'));
    }

    if (next) {
      textLayerRefs
        .get(next.pageNumber)
        ?.querySelectorAll<HTMLElement>(`[data-search-match-index="${nextIndex}"]`)
        .forEach((element) => element.classList.add('selected'));
    }

    setSelectedMatch(nextIndex);
    scrollToSearchMatch(next);
  };

  const search = async (direction: 1 | -1) => {
    const query = searchValue().trim();
    if (!query || !worker) {
      clearSearchHighlights();
      return;
    }

    const currentSearchGeneration = ++searchGeneration;
    const normalizedQuery = query.toLocaleLowerCase();
    const isContinuation = executedSearchQuery === query;
    if (isContinuation) {
      const matches = searchMatches();
      const nextIndex = matches.length
        ? (selectedMatch() + direction + matches.length) % matches.length
        : -1;
      selectSearchMatch(matches, nextIndex);
      return;
    }

    const matches: SearchMatch[] = [];
    for (const page of pages()) {
      let zones = textByPage.get(page.pageNumber);
      if (!zones) {
        zones = (await worker.doc.getPage(page.pageNumber).getNormalizedTextZones().run()) ?? [];
        if (currentSearchGeneration !== searchGeneration) return;
        textByPage.set(page.pageNumber, zones);
      }
      const zoneStarts: number[] = [];
      const pageText = zones.reduce((text, zone) => {
        zoneStarts.push(text.length + (text ? 1 : 0));
        return `${text}${text ? ' ' : ''}${zone.text}`;
      }, '');
      const normalizedPageText = pageText.toLocaleLowerCase();
      let start = normalizedPageText.indexOf(normalizedQuery);
      while (start >= 0) {
        const end = start + query.length;
        const segments = zones.flatMap((zone, zoneIndex) => {
          const zoneStart = zoneStarts[zoneIndex];
          const zoneEnd = zoneStart + zone.text.length;
          const segmentStart = Math.max(start, zoneStart);
          const segmentEnd = Math.min(end, zoneEnd);

          return segmentStart < segmentEnd
            ? [{ zoneIndex, start: segmentStart - zoneStart, length: segmentEnd - segmentStart }]
            : [];
        });

        if (segments.length) matches.push({ pageNumber: page.pageNumber, segments });
        start = normalizedPageText.indexOf(normalizedQuery, start + normalizedQuery.length);
      }
    }

    if (currentSearchGeneration !== searchGeneration) return;

    executedSearchQuery = query;
    setSearchMatches(matches);
    let firstMatchIndex = -1;
    if (direction === 1) {
      firstMatchIndex = matches.findIndex((match) => match.pageNumber >= currentPage());
    } else {
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        if (matches[index].pageNumber <= currentPage()) {
          firstMatchIndex = index;
          break;
        }
      }
    }
    const nextIndex = matches.length
      ? firstMatchIndex >= 0
        ? firstMatchIndex
        : direction === 1
          ? 0
          : matches.length - 1
      : -1;
    for (const page of pages()) renderTextLayer(page.pageNumber);
    selectSearchMatch(matches, nextIndex);
  };

  const selectToc = async (entry: TocEntry) => {
    const target = tocTargets.get(entry);
    if (!target) return;
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    const pageNumber = await worker?.doc.getPageNumberByUrl(target).run();
    if (pageNumber) {
      readerNavigationHistory.recordNavigation({ pageNumber, offsetRatio: 0 });
      pageRefs.get(pageNumber)?.scrollIntoView({ block: 'start' });
    }
  };

  const updateFilterChain = (update: (chain: PdfFilterChain) => PdfFilterChain) => {
    const next = update(filterChain());
    setFilterChain(next);
    setFilterError(
      hasEnabledPdfFilters(next) && !isPdfWebglAvailable() ? 'pdfFiltersUnavailable' : undefined,
    );
    setFixedLayoutReaderFilterChainPreference(props.bookId ?? props.fileUrl, next);
    refreshVisiblePages();
  };

  const updateWidth = (width: number | undefined) => {
    if (width === maxWidth()) return;

    widthScrollAnchor ??= captureScrollAnchor();
    widthUpdatePending = true;
    setMaxWidth(width);

    if (widthScrollAnchorFrame !== undefined) {
      cancelAnimationFrame(widthScrollAnchorFrame);
    }
    widthScrollAnchorFrame = requestAnimationFrame(() => {
      widthScrollAnchorFrame = undefined;
      if (widthScrollAnchor) scrollToAnchor(widthScrollAnchor);
      restoreHorizontalScrollPositionIfNeeded();
    });
  };
  const commitWidthUpdate = () => {
    if (!widthUpdatePending) return;

    widthUpdatePending = false;
    setFixedLayoutReaderContentWidthPreference(maxWidth());
    refreshVisiblePages();

    if (widthScrollAnchorFrame !== undefined) {
      cancelAnimationFrame(widthScrollAnchorFrame);
    }
    widthScrollAnchorFrame = requestAnimationFrame(() => {
      widthScrollAnchorFrame = undefined;
      const anchor = widthScrollAnchor;
      widthScrollAnchor = undefined;
      if (anchor) scrollToAnchor(anchor);
      restoreHorizontalScrollPositionIfNeeded();
    });
  };
  const updateOverflow = (value: number) => {
    const next = clampPdfPageWidthOverflow(value);
    if (next === overflow()) return;

    overflowScrollAnchor ??= captureScrollAnchor();
    setOverflow(next);
    setFixedLayoutReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl, next);
    refreshVisiblePages();

    if (overflowScrollAnchorFrame !== undefined) {
      cancelAnimationFrame(overflowScrollAnchorFrame);
    }
    overflowScrollAnchorFrame = requestAnimationFrame(() => {
      overflowScrollAnchorFrame = undefined;
      const anchor = overflowScrollAnchor;
      overflowScrollAnchor = undefined;
      if (anchor) scrollToAnchor(anchor);
      restoreHorizontalScrollPositionIfNeeded();
    });
  };

  const readerNavigationHistory = useReaderNavigationHistory({
    readerId: untrack(preferenceKey),
    captureLocation: captureScrollAnchor,
    restoreLocation: scrollToAnchor,
    isLocation: (value): value is ScrollAnchor => {
      if (typeof value !== 'object' || value === null) return false;
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

  const goToPage = (value: string) => {
    const requested = Number.parseInt(value, 10);
    const pageNumber = Math.min(
      Math.max(Number.isFinite(requested) ? requested : currentPage(), 1),
      pages().length,
    );
    if (!pageRefs.has(pageNumber)) return;

    pageRefs.get(pageNumber)?.scrollIntoView({ block: 'start' });
    setCurrentPage(pageNumber);
    setPageInput(String(pageNumber));
  };

  const readerChrome = useReaderChrome({
    keepVisible: () => tocOpen() || filterPanelOpen() || draggingWidth(),
    onClose: () => {
      setTocOpen(false);
      setFilterPanelOpen(false);
    },
  });

  createEffect(() => {
    visiblePages();
    pages();
    scheduleVisiblePageRendering();
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

    for (const page of currentPages) {
      if (page.pageNumber >= retainMin && page.pageNumber <= retainMax) {
        continue;
      }

      if (!hasAllocatedPageResources(page.pageNumber)) {
        continue;
      }

      releasePageResources(page.pageNumber);
    }
  });
  createEffect(() => {
    void props.fileUrl;
    void loadDocument();
  });
  createEffect(() => {
    const key = preferenceKey();
    setHorizontalScrollPosition(getFixedLayoutReaderHorizontalScrollPositionPreference(key));
    restoreHorizontalScrollPositionIfNeeded();
  });

  onMount(() => {
    const syncCurrentPage = () => {
      const viewportCenter = window.innerHeight / 2;
      let closestPage = currentPage();
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const page of pages()) {
        const rect = pageRefs.get(page.pageNumber)?.getBoundingClientRect();

        if (!rect) {
          continue;
        }

        if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
          closestPage = page.pageNumber;
          break;
        }

        const distance = Math.min(
          Math.abs(rect.top - viewportCenter),
          Math.abs(rect.bottom - viewportCenter),
        );

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = page.pageNumber;
        }
      }

      setCurrentPage(closestPage);
      setPageInput(String(closestPage));
      readerNavigationHistory.updateCurrentLocation();
    };

    observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((current) => {
          const next = new Set(current);
          entries.forEach((entry) => {
            const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (entry.isIntersecting) next.add(pageNumber);
            else next.delete(pageNumber);
          });
          return next;
        });
      },
      { rootMargin: '1200px 0px' },
    );
    resizeObserver = new ResizeObserver(measure);
    if (rootRef) resizeObserver.observe(rootRef);
    measure();
    const syncScroll = () => {
      syncCurrentPage();
      lastScrollAnchor = captureScrollAnchor();
      rememberHorizontalScrollPosition();
      deferRenderingUntilScrollSettles();
    };
    window.addEventListener('scroll', syncScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', syncScroll));
  });
  createEffect(() => {
    pages();
    requestAnimationFrame(() => {
      pageRefs.forEach((element) => observer?.observe(element));
      restoreHorizontalScrollPositionIfNeeded();
    });
  });
  onCleanup(() => {
    destroyed = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    worker?.worker.terminate();
    destroySharedPdfWebglFilterRenderer();
    if (horizontalScrollRestoreFrame !== undefined)
      cancelAnimationFrame(horizontalScrollRestoreFrame);
    if (widthScrollAnchorFrame !== undefined) cancelAnimationFrame(widthScrollAnchorFrame);
    if (overflowScrollAnchorFrame !== undefined) cancelAnimationFrame(overflowScrollAnchorFrame);
    if (resizeScrollAnchorFrame !== undefined) cancelAnimationFrame(resizeScrollAnchorFrame);
    if (searchScrollFrame !== undefined) cancelAnimationFrame(searchScrollFrame);
    if (renderAfterScrollTimeout !== undefined) clearTimeout(renderAfterScrollTimeout);
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ''}`}>
      <ReaderFloatingChrome
        visible={readerChrome.visible()}
        title={props.title}
        headerContent={props.headerContent}
        searchValue={searchValue()}
        searchCount={searchCount()}
        onSearchValueChange={setSearchValue}
        onSearchNext={() => void search(1)}
        onSearchPrevious={() => void search(-1)}
        onSearchOpen={() => {
          setTocOpen(false);
          setFilterPanelOpen(false);
        }}
        onClose={() => {
          clearSearchHighlights();
          readerChrome.close();
        }}
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
              onClick={() => setFilterPanelOpen(!filterPanelOpen())}
            />
            <Button
              variant="secondary"
              type="button"
              iconOnly
              iconStart={<ListTree />}
              title={outline().length ? t('tableOfContents') : t('tableOfContentsUnavailable')}
              aria-label={outline().length ? t('tableOfContents') : t('tableOfContentsUnavailable')}
              aria-pressed={tocOpen()}
              disabled={!outlineLoaded() || !outline().length}
              onClick={() => setTocOpen(!tocOpen())}
            />
          </>
        }
        secondaryBar={
          <WidthRuler
            availableWidth={availableWidth()}
            currentWidth={baseWidth()}
            markerStyles={markerStyles()}
            ariaLabel={t('pageWidth')}
            minWidth={minPageWidth}
            onRulerRef={setRulerElement}
            onPointerDown={(event) => {
              (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
              setDraggingWidth(true);
              readerChrome.show();
              handleRulerPointer(event);
            }}
            onPointerMove={(event) => {
              if (draggingWidth()) handleRulerPointer(event);
            }}
            onPointerUp={(event) => {
              (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
              handleRulerPointer(event);
              commitWidthUpdate();
              setDraggingWidth(false);
              setGuideX(undefined);
            }}
          />
        }
        bottomContent={
          <label class={styles.pageControl}>
            <span class={styles.pageControlLabel}>{t('page')}</span>
            <TextInput
              class={styles.pageInput}
              type="number"
              min="1"
              max={pages().length || undefined}
              value={pageInput()}
              aria-label={t('pageNumber')}
              onInput={(event) => setPageInput(event.currentTarget.value)}
              onBlur={() => goToPage(pageInput())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToPage(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }}
            />
            <span>/ {pages().length}</span>
          </label>
        }
      />
      <Show when={draggingWidth() && guideX() !== undefined}>
        <div class={styles.widthGuide} style={{ left: `${guideX()}px` }} aria-hidden="true" />
      </Show>
      <TocPanel
        open={tocOpen()}
        entries={outline()}
        onClose={() => setTocOpen(false)}
        onSelect={selectToc}
      />
      <PdfFilterPanel
        open={filterPanelOpen()}
        filterChain={filterChain()}
        textEnhancementFilter={
          textEnhancement() ?? textEnhancementFilterFromChain(defaultPdfFilterChain())!
        }
        softTextEnhancementFilter={
          softTextEnhancement() ?? softTextEnhancementFilterFromChain(defaultPdfFilterChain())!
        }
        invertFilter={invert() ?? invertFilterFromChain(defaultPdfFilterChain())!}
        visualAdjustmentFilter={
          visualAdjustment() ?? visualAdjustmentFilterFromChain(defaultPdfFilterChain())!
        }
        warmthFilter={warmth() ?? warmthFilterFromChain(defaultPdfFilterChain())!}
        grayscaleFilter={grayscale() ?? grayscaleFilterFromChain(defaultPdfFilterChain())!}
        pageWidthOverflow={overflow()}
        available={!filterError()}
        unavailableMessage={filterError() ? t('pdfFiltersUnavailable') : undefined}
        onClose={() => setFilterPanelOpen(false)}
        onToggleTextEnhancement={(enabled) =>
          updateFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'textEnhancement' ? { ...filter, enabled } : filter,
            ),
          )
        }
        onTextEnhancementParameterChange={(parameter, value) =>
          updateFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'textEnhancement' ? { ...filter, [parameter]: value } : filter,
            ),
          )
        }
        onToggleSoftTextEnhancement={(enabled) =>
          updateFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'softTextEnhancement' ? { ...filter, enabled } : filter,
            ),
          )
        }
        onSoftTextEnhancementParameterChange={(parameter, value) =>
          updateFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'softTextEnhancement' ? { ...filter, [parameter]: value } : filter,
            ),
          )
        }
        onToggleInvert={(enabled) =>
          updateFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'invert' ? { ...filter, enabled } : filter)),
          )
        }
        onStrengthChange={(strength) =>
          updateFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'invert' ? { ...filter, strength } : filter)),
          )
        }
        onToggleVisualAdjustment={(enabled) =>
          updateFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'visualAdjustment' ? { ...filter, enabled } : filter,
            ),
          )
        }
        onVisualAdjustmentParameterChange={(parameter, value) =>
          updateFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'visualAdjustment' ? { ...filter, [parameter]: value } : filter,
            ),
          )
        }
        onToggleWarmth={(enabled) =>
          updateFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'warmth' ? { ...filter, enabled } : filter)),
          )
        }
        onWarmthStrengthChange={(strength) =>
          updateFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'warmth' ? { ...filter, strength } : filter)),
          )
        }
        onToggleGrayscale={(enabled) =>
          updateFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'grayscale' ? { ...filter, enabled } : filter)),
          )
        }
        onGrayscaleStrengthChange={(strength) =>
          updateFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'grayscale' ? { ...filter, strength } : filter)),
          )
        }
        onMoveFilter={(id, index) =>
          updateFilterChain((chain) => {
            const from = chain.findIndex((filter) => filter.id === id);
            if (from < 0) return chain;
            const next = [...chain];
            const [moved] = next.splice(from, 1);
            next.splice(index, 0, moved);
            return next;
          })
        }
        onPageWidthOverflowChange={updateOverflow}
        onReset={() => {
          updateFilterChain(() => defaultPdfFilterChain());
          updateOverflow(defaultPdfPageWidthOverflow);
        }}
        onAutoWidth={resetToFitWidth}
      />
      <Show when={loading()}>
        <LoadingScreen label={t('loading')} />
      </Show>
      <Show when={failed()}>
        <div class={styles.state}>{t('requestFailedTryAgain')}</div>
      </Show>
      <Show when={!loading() && !failed()}>
        <main
          ref={documentRef}
          class={styles.document}
          classList={{ [styles.documentFit]: isFitWidth() }}
          onPointerUp={(event) => {
            if (readerChrome.toggleOnTouch(event)) event.preventDefault();
          }}
          onClick={readerChrome.onDocumentClick}
        >
          {
            <For each={pages()}>
              {(page) => (
                <section
                  ref={(element) => pageRefs.set(page.pageNumber, element)}
                  class={styles.page}
                  classList={{ [styles.pageFit]: isFitWidth() }}
                  data-page-number={page.pageNumber}
                  role="region"
                  aria-label={`${t('page')} ${page.pageNumber}`}
                  style={{
                    width: `${pageWidth()}px`,
                    'max-width': overflow() > 0 ? 'none' : '100%',
                    'aspect-ratio': `${page.width} / ${page.height}`,
                  }}
                >
                  <canvas
                    class={styles.sourceCanvas}
                    ref={(element) => canvasRefs.set(page.pageNumber, element)}
                  />
                  <Show when={filtersEnabled()}>
                    <canvas
                      class={styles.filteredCanvas}
                      ref={(element) => filteredCanvasRefs.set(page.pageNumber, element)}
                      aria-hidden="true"
                    />
                  </Show>
                  <div
                    class={styles.textLayer}
                    data-testid="djvu-text-layer"
                    ref={(element) => textLayerRefs.set(page.pageNumber, element)}
                  />
                </section>
              )}
            </For>
          }
        </main>
      </Show>
    </div>
  );
}

export default DjvuReader;
