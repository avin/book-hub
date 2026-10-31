import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { X } from 'lucide-solid';
import { clearCache } from '@chenglou/pretext';
import BlockView from './BlockView/BlockView';
import Button from '@/components/common/Button/Button';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import { findBlockIndex, buildVirtualLayout } from './reflowableLayout';
import { isReaderLayoutFontReady, loadReaderLayoutFonts } from './reflowableFontMetrics';
import { binaryToDataUrl } from './reflowableBinary';
import { defaultSettings } from './reflowableReaderSettings';
import {
  findReflowableSearchMatches,
  normalizeSearchQuery,
  type ReflowableSearchMatch,
  type ReflowableSearchRange,
} from './reflowableSearch';
import type {
  ReflowableBlock,
  ReflowableCssVars,
  ReflowableDocument,
  ReflowableInline,
  ReflowableNote,
  ReflowableReaderSettings,
  VirtualLayout,
} from './reflowableTypes';
import ReaderChrome from './ReaderChrome/ReaderChrome';
import SettingsPanel from './SettingsPanel/SettingsPanel';
import useReaderChrome from '@/components/common/ReaderChrome/useReaderChrome';
import useReaderNavigationHistory from '@/components/common/ReaderChrome/useReaderNavigationHistory';
import TocPanel from '@/components/common/TocPanel/TocPanel';
import type { TocEntry } from '@/components/common/TocPanel/TocList/TocList';
import {
  applyWidthRulerPointer,
  computeWidthRulerMarkers,
} from '@/components/common/WidthRuler/widthRulerUtils';
import {
  getReflowableReaderSettingsPreference,
  setReflowableReaderSettingsPreference,
} from '@/storage/browserPreferencesReflowable';
import styles from './ReflowableReader.module.scss';
import { useI18n } from '@/i18n/I18nProvider';

type ScrollAnchor = {
  blockIndex: number;
  offsetPx: number;
};

type ReaderPanel = 'none' | 'settings' | 'toc';

const layoutWidthDebounceMs = 120;
const viewportResizeEndMs = 150;
const settingsPersistDebounceMs = 300;

function visualViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function settingValue<T extends keyof ReflowableReaderSettings>(
  settings: ReflowableReaderSettings,
  key: T,
  value: ReflowableReaderSettings[T],
) {
  return { ...settings, [key]: value };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function elementContentWidth(element: HTMLElement | undefined) {
  if (!element) {
    return 0;
  }

  const styles = getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;

  return Math.max(1, element.clientWidth - paddingLeft - paddingRight);
}

function elementContentBounds(element: HTMLElement | undefined) {
  if (!element) {
    return undefined;
  }

  const rect = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;

  return {
    left: rect.left + paddingLeft,
    right: rect.right - paddingRight,
  };
}

function inlineText(inlines: ReflowableInline[] | undefined): string {
  return (
    inlines
      ?.map((inline) => inline.text ?? inlineText(inline.children))
      .join('')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

function splitFootnote(
  note: ReflowableNote | undefined,
  fallbackTitle: string,
): { title: string; blocks: ReflowableBlock[] } | undefined {
  if (!note) {
    return undefined;
  }

  const titleParts: string[] = [];
  let contentStartIndex = 0;

  while (
    contentStartIndex < note.blocks.length &&
    (note.blocks[contentStartIndex].kind === 'title' ||
      note.blocks[contentStartIndex].kind === 'subtitle')
  ) {
    const text = inlineText(note.blocks[contentStartIndex].inlines);

    if (text) {
      titleParts.push(text);
    }

    contentStartIndex += 1;
  }

  const title = titleParts.join(' ');

  return {
    title: title || fallbackTitle,
    blocks: note.blocks.slice(contentStartIndex),
  };
}

function ReflowableReader(props: {
  document: ReflowableDocument;
  historyId?: string;
  class?: string;
  initialSettings?: Partial<ReflowableReaderSettings>;
  headerContent?: JSX.Element;
}) {
  const { t } = useI18n();
  let rootRef: HTMLDivElement | undefined;
  let documentShellRef: HTMLElement | undefined;
  let documentRef: HTMLElement | undefined;
  let scrollAnchorFrame: number | undefined;
  let lockedScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeAnchorTimeout: number | undefined;
  let layoutWidthDebounceTimeout: number | undefined;
  let viewportResizeEndTimeout: number | undefined;
  let resetAnchorFrame: number | undefined;
  let layoutSettingsAnchor: ScrollAnchor | undefined;
  let fontLayoutAnchor: ScrollAnchor | undefined;
  let executedSearchQuery: string | undefined;
  let searchScrollFrame: number | undefined;
  let lastMeasuredReaderWidth = 0;
  let settingsPersistTimeout: number | undefined;
  let disposed = false;
  const [settings, setSettings] = createSignal<ReflowableReaderSettings>({
    ...defaultSettings,
    ...getReflowableReaderSettingsPreference(),
    ...props.initialSettings,
  });
  const [viewportHeight, setViewportHeight] = createSignal(900);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [readerWidth, setReaderWidth] = createSignal(960);
  const [layoutTextWidth, setLayoutTextWidth] = createSignal(320);
  const [viewportResizeActive, setViewportResizeActive] = createSignal(false);
  const [searchValue, setSearchValue] = createSignal('');
  const [searchMatches, setSearchMatches] = createSignal<ReflowableSearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = createSignal<number | undefined>();
  const [openPanel, setOpenPanel] = createSignal<ReaderPanel>('none');
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
  const [pendingMaxTextWidth, setPendingMaxTextWidth] = createSignal<number | undefined>();
  const [adjustingLayoutSettings, setAdjustingLayoutSettings] = createSignal(false);
  const [pendingScrollAnchor, setPendingScrollAnchor] = createSignal<ScrollAnchor>();
  const [activeFootnoteId, setActiveFootnoteId] = createSignal<string>();
  const [layoutGeneration, setLayoutGeneration] = createSignal(0);
  const [rulerElement, setRulerElement] = createSignal<HTMLDivElement>();
  let lastMeasuredLayout: VirtualLayout = { offsets: [], heights: [], totalHeight: 0 };
  const parsed = createMemo(() => props.document);
  const availableTextWidth = createMemo(() => readerWidth());
  const effectiveMaxTextWidth = createMemo(() =>
    draggingWidth() ? pendingMaxTextWidth() : settings().maxTextWidth,
  );
  const textWidth = createMemo(() =>
    Math.min(availableTextWidth(), effectiveMaxTextWidth() ?? availableTextWidth()),
  );

  const currentWidthChangeAnchor = () =>
    lockedScrollAnchor ?? resizeScrollAnchor ?? captureScrollAnchor();

  const restoreScrollAnchorAfterLayout = (anchor: ScrollAnchor | undefined) => {
    if (!anchor) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentLayout = layout();
        const blockIndex = Math.min(anchor.blockIndex, currentLayout.offsets.length - 1);

        if (blockIndex < 0 || !documentRef) {
          return;
        }

        const documentTop = documentRef.getBoundingClientRect().top + window.scrollY;
        const nextScrollTop =
          documentTop + (currentLayout.offsets[blockIndex] ?? 0) + anchor.offsetPx;

        window.scrollTo({ top: nextScrollTop });
        setScrollTop(nextScrollTop - documentTop);
        setPendingScrollAnchor(undefined);
      });
    });
  };

  const applyLayoutTextWidth = (anchor = currentWidthChangeAnchor()) => {
    if (anchor) {
      setPendingScrollAnchor(anchor);
    }

    setLayoutTextWidth(textWidth());
  };

  const flushLayoutTextWidth = () => {
    if (layoutWidthDebounceTimeout !== undefined) {
      window.clearTimeout(layoutWidthDebounceTimeout);
      layoutWidthDebounceTimeout = undefined;
    }

    applyLayoutTextWidth();
  };

  const scheduleLayoutTextWidth = () => {
    const anchor = currentWidthChangeAnchor();

    if (layoutWidthDebounceTimeout !== undefined) {
      window.clearTimeout(layoutWidthDebounceTimeout);
    }

    layoutWidthDebounceTimeout = window.setTimeout(() => {
      untrack(() => {
        applyLayoutTextWidth(anchor);
        layoutWidthDebounceTimeout = undefined;
      });
    }, layoutWidthDebounceMs);
  };

  let frozenLayoutSettings: ReflowableReaderSettings | undefined;
  const layoutSettings = createMemo(
    () => {
      const s = settings();

      if (adjustingLayoutSettings() && frozenLayoutSettings) {
        return frozenLayoutSettings;
      }

      frozenLayoutSettings = s;
      return s;
    },
    undefined,
    {
      equals: (prev, next) =>
        !!prev &&
        prev.fontFamily === next.fontFamily &&
        prev.fontSize === next.fontSize &&
        prev.lineHeight === next.lineHeight &&
        prev.paragraphSpacing === next.paragraphSpacing &&
        prev.paragraphIndent === next.paragraphIndent,
    },
  );

  const layout = createMemo(() => {
    layoutGeneration();
    const currentSettings = layoutSettings();

    if (typeof document !== 'undefined' && !isReaderLayoutFontReady(currentSettings)) {
      return lastMeasuredLayout;
    }

    lastMeasuredLayout = buildVirtualLayout(parsed().blocks, layoutTextWidth(), currentSettings);

    return lastMeasuredLayout;
  });
  const imageSrcCache = createMemo(() => {
    void parsed();
    return new Map<string, string | undefined>();
  });
  const imageSrc = (id: string | undefined) => {
    if (!id) {
      return undefined;
    }

    const cache = imageSrcCache();

    if (!cache.has(id)) {
      cache.set(id, binaryToDataUrl(parsed().binaries.get(id)));
    }

    return cache.get(id);
  };
  const cssVars = createMemo<ReflowableCssVars>(() => ({
    '--fb2-bg': settings().backgroundColor,
    '--fb2-text': settings().textColor,
    '--fb2-link': settings().linkColor,
    '--fb2-font-family': settings().fontFamily,
    '--fb2-font-size': `${settings().fontSize}px`,
    '--fb2-line-height': String(settings().lineHeight),
    '--fb2-paragraph-indent': `${settings().paragraphIndent}px`,
  }));
  const markerStyles = createMemo<{ left: JSX.CSSProperties; right: JSX.CSSProperties }>(() =>
    computeWidthRulerMarkers(rulerElement(), effectiveMaxTextWidth(), availableTextWidth()),
  );
  const visibleRange = createMemo(
    () => {
      const currentLayout = layout();
      const blockCount = parsed().blocks.length;
      const overscan = 1000;
      const start = findBlockIndex(currentLayout.offsets, Math.max(0, scrollTop() - overscan));
      const endLimit = scrollTop() + viewportHeight() + overscan;
      let end = start;

      while (end < blockCount && currentLayout.offsets[end] < endLimit) {
        end += 1;
      }

      return { start, end };
    },
    { start: 0, end: 0 },
    { equals: (previous, next) => previous.start === next.start && previous.end === next.end },
  );
  const visibleBlockIndexes = createMemo(() => {
    const { start, end } = visibleRange();

    return Array.from({ length: end - start }, (_, offset) => start + offset);
  });
  const topSpacer = createMemo(() =>
    visibleRange().end > visibleRange().start ? (layout().offsets[visibleRange().start] ?? 0) : 0,
  );
  const bottomSpacer = createMemo(() => {
    const { start, end } = visibleRange();
    const currentLayout = layout();

    if (end <= start) {
      return currentLayout.totalHeight;
    }

    const last = end - 1;

    return Math.max(
      0,
      currentLayout.totalHeight -
        (currentLayout.offsets[last] ?? 0) -
        (currentLayout.heights[last] ?? 0),
    );
  });
  const documentTitle = createMemo(() => {
    const authors = parsed().authors.join(', ');

    return [parsed().title, authors].filter(Boolean).join(' · ') || 'FB2';
  });
  const activeFootnote = createMemo(() => {
    const id = activeFootnoteId();

    return id ? parsed().notes.get(id) : undefined;
  });
  const activeFootnoteDialog = createMemo(() => splitFootnote(activeFootnote(), t('footnote')));
  const anchorIndex = createMemo(() => {
    const index = new Map<string, number>();

    parsed().blocks.forEach((block, blockIndex) => {
      if (block.sourceId && !index.has(block.sourceId)) {
        index.set(block.sourceId, blockIndex);
      }

      if (!index.has(block.id)) {
        index.set(block.id, blockIndex);
      }
    });

    return index;
  });
  const tocEntries = createMemo<TocEntry[]>(() => parsed().outline);
  const tocAvailable = createMemo(() => tocEntries().length > 0);
  const sidePanelOpen = createMemo(() => openPanel() !== 'none');
  const progressPercent = createMemo(() => {
    const maxScroll = Math.max(0, layout().totalHeight - viewportHeight());

    if (maxScroll === 0) {
      return 0;
    }

    return Math.round(clamp((scrollTop() / maxScroll) * 100, 0, 100));
  });
  const searchCount = createMemo(() => {
    const total = searchMatches().length;
    const active = activeSearchIndex();

    return total > 0 && active !== undefined ? { current: active + 1, total } : undefined;
  });

  const togglePanel = (panel: Exclude<ReaderPanel, 'none'>) => {
    setOpenPanel((current) => (current === panel ? 'none' : panel));
  };

  const closePanel = () => {
    setOpenPanel('none');
  };

  const clearSearchHighlights = () => {
    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
      searchScrollFrame = undefined;
    }

    setSearchMatches([]);
    setActiveSearchIndex(undefined);
    executedSearchQuery = undefined;
  };

  const readerChrome = useReaderChrome({
    keepVisible: () => sidePanelOpen() || draggingWidth(),
    onClose: () => {
      closePanel();
      clearSearchHighlights();
    },
    hoverOffsets: { hide: 164, show: 88 },
  });

  const documentScrollTop = () => {
    if (!documentRef) {
      return scrollTop();
    }

    const documentTop = documentRef.getBoundingClientRect().top + window.scrollY;

    return Math.max(0, window.scrollY - documentTop);
  };

  const captureScrollAnchor = () => {
    const currentLayout = layout();

    if (currentLayout.offsets.length === 0) {
      return undefined;
    }

    const currentDocumentScrollTop = documentScrollTop();
    const blockIndex = findBlockIndex(currentLayout.offsets, currentDocumentScrollTop);
    const blockTop = currentLayout.offsets[blockIndex] ?? 0;
    // Процент внутри блока нельзя использовать: после смены ширины или
    // шрифта блок может получить другое число строк, и тот же процент покажет
    // уже другой текст. Пиксельное смещение сохраняет текущий видимый блок.
    const offsetPx = clamp(
      currentDocumentScrollTop - blockTop,
      0,
      Math.max(0, currentLayout.heights[blockIndex] ?? 0),
    );

    return { blockIndex, offsetPx };
  };

  const updateSetting = <T extends keyof ReflowableReaderSettings>(
    key: T,
    value: ReflowableReaderSettings[T],
    keepLockedAnchor = false,
  ) => {
    const anchor =
      keepLockedAnchor && lockedScrollAnchor
        ? lockedScrollAnchor
        : (layoutSettingsAnchor ?? captureScrollAnchor());

    if (anchor) {
      setPendingScrollAnchor(anchor);

      if (key === 'fontFamily' || key === 'fontSize') {
        fontLayoutAnchor ??= anchor;
      }
    }

    setSettings((current) => settingValue(current, key, value));
  };

  const scrollToBlockIndex = (blockIndex: number, behavior: ScrollBehavior = 'smooth') => {
    if (!documentRef) {
      return;
    }

    const currentLayout = layout();
    const blockTop = currentLayout.offsets[blockIndex];

    if (blockTop === undefined) {
      return;
    }

    const documentTop = documentRef.getBoundingClientRect().top + window.scrollY;
    const nextScrollTop = documentTop + blockTop;

    window.scrollTo({ top: nextScrollTop, behavior });
    setScrollTop(blockTop);
  };

  const readerNavigationHistory = useReaderNavigationHistory({
    readerId: untrack(() => props.historyId ?? 'fb2-reader'),
    captureLocation: captureScrollAnchor,
    restoreLocation: restoreScrollAnchorAfterLayout,
    isLocation: (value): value is ScrollAnchor => {
      if (typeof value !== 'object' || value === null) {
        return false;
      }

      const location = value as Partial<ScrollAnchor>;

      return (
        typeof location.blockIndex === 'number' &&
        Number.isInteger(location.blockIndex) &&
        location.blockIndex >= 0 &&
        typeof location.offsetPx === 'number' &&
        Number.isFinite(location.offsetPx) &&
        location.offsetPx >= 0
      );
    },
  });

  type SearchDirection = 'next' | 'previous';

  const currentSearchPosition = () => {
    const currentLayout = layout();

    if (currentLayout.offsets.length === 0) {
      return { blockIndex: 0, offset: 0 };
    }

    const currentDocumentScrollTop = documentScrollTop();
    const blockIndex = findBlockIndex(currentLayout.offsets, currentDocumentScrollTop);
    const blockTop = currentLayout.offsets[blockIndex] ?? 0;

    return { blockIndex, offset: Math.max(0, currentDocumentScrollTop - blockTop) };
  };

  const compareSearchMatchToPosition = (
    match: ReflowableSearchMatch,
    position: { blockIndex: number; offset: number },
  ) => {
    if (match.blockIndex !== position.blockIndex) {
      return match.blockIndex - position.blockIndex;
    }

    return match.start - position.offset;
  };

  const firstSearchMatchIndex = (matches: ReflowableSearchMatch[], direction: SearchDirection) => {
    const position = currentSearchPosition();

    if (direction === 'next') {
      const index = matches.findIndex(
        (match) => compareSearchMatchToPosition(match, position) >= 0,
      );

      return index === -1 ? 0 : index;
    }

    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (compareSearchMatchToPosition(matches[index], position) <= 0) {
        return index;
      }
    }

    return matches.length - 1;
  };

  const scrollToSearchMatch = (match: ReflowableSearchMatch) => {
    const findRenderedMatch = () =>
      rootRef?.querySelector<HTMLElement>(`[data-search-match="${match.key}"]`);

    const focusRenderedMatch = () => {
      const element = findRenderedMatch();

      if (element) {
        element.scrollIntoView({ behavior: 'instant', block: 'center' });
        updateScrollPosition();
        return;
      }

      scrollToBlockIndex(match.blockIndex, 'instant');
      searchScrollFrame = requestAnimationFrame(() => {
        searchScrollFrame = undefined;
        findRenderedMatch()?.scrollIntoView({ behavior: 'instant', block: 'center' });
        updateScrollPosition();
      });
    };

    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
    }

    searchScrollFrame = requestAnimationFrame(() => {
      searchScrollFrame = undefined;
      focusRenderedMatch();
    });
  };

  const search = (direction: SearchDirection) => {
    const query = normalizeSearchQuery(searchValue());

    if (!query) {
      setSearchMatches([]);
      setActiveSearchIndex(undefined);
      executedSearchQuery = query;
      return;
    }

    const activeIndex = activeSearchIndex();
    const isContinuation =
      executedSearchQuery === query && activeIndex !== undefined && searchMatches().length > 0;
    let matches = searchMatches();

    if (!isContinuation) {
      matches = findReflowableSearchMatches(parsed().blocks, query);
      setSearchMatches(matches);

      if (matches.length === 0) {
        setActiveSearchIndex(undefined);
        executedSearchQuery = query;
        return;
      }

      const nextIndex = firstSearchMatchIndex(matches, direction);
      setActiveSearchIndex(nextIndex);
      executedSearchQuery = query;
      scrollToSearchMatch(matches[nextIndex]);
      return;
    }

    const nextIndex =
      direction === 'next'
        ? (activeIndex + 1) % matches.length
        : (activeIndex - 1 + matches.length) % matches.length;
    setActiveSearchIndex(nextIndex);
    scrollToSearchMatch(matches[nextIndex]);
  };

  const searchRangesByBlock = createMemo(() => {
    const activeIndex = activeSearchIndex();
    const rangesByBlock = new Map<number, ReflowableSearchRange[]>();

    searchMatches().forEach((match, index) => {
      const ranges = rangesByBlock.get(match.blockIndex) ?? [];

      ranges.push({ ...match, active: index === activeIndex });
      rangesByBlock.set(match.blockIndex, ranges);
    });

    return rangesByBlock;
  });

  const onTocSelect = (_entry: TocEntry, path: number[]) => {
    let nodes = parsed().outline;
    let node: (typeof nodes)[number] | undefined;

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

    const blockIndex = anchorIndex().get(node.targetId);

    if (blockIndex !== undefined) {
      readerNavigationHistory.recordNavigation({ blockIndex, offsetPx: 0 });
      scrollToBlockIndex(blockIndex, 'instant');
    }
  };

  const onInternalLink = (targetId: string) => {
    const blockIndex = anchorIndex().get(targetId);

    if (blockIndex === undefined) {
      return;
    }

    readerNavigationHistory.recordNavigation({ blockIndex, offsetPx: 0 });
    scrollToBlockIndex(blockIndex);
  };

  const beginLayoutSettingsAdjustment = () => {
    layoutSettingsAnchor ??= captureScrollAnchor();

    if (layoutSettingsAnchor) {
      setPendingScrollAnchor(layoutSettingsAnchor);
    }

    setAdjustingLayoutSettings(true);
  };

  const endLayoutSettingsAdjustment = () => {
    const anchor = layoutSettingsAnchor;

    setAdjustingLayoutSettings(false);
    restoreScrollAnchorAfterLayout(anchor);
  };
  const isFootnoteTarget = (targetId: string) => parsed().notes.has(targetId);
  const onFootnoteLink = (targetId: string) => {
    if (isFootnoteTarget(targetId)) {
      setActiveFootnoteId(targetId);
    }
  };
  const closeFootnote = () => setActiveFootnoteId(undefined);
  const onFootnoteInternalLink = (targetId: string) => {
    closeFootnote();
    onInternalLink(targetId);
  };

  const lockResizeScrollAnchor = () => {
    if (lockedScrollAnchor) {
      return;
    }

    resizeScrollAnchor = resizeScrollAnchor ?? captureScrollAnchor();

    if (resizeScrollAnchor) {
      setPendingScrollAnchor(resizeScrollAnchor);
    }

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    resizeAnchorTimeout = window.setTimeout(() => {
      resizeScrollAnchor = undefined;
      resizeAnchorTimeout = undefined;
    }, 180);
  };

  const markViewportResize = () => {
    setViewportResizeActive(true);

    if (viewportResizeEndTimeout !== undefined) {
      window.clearTimeout(viewportResizeEndTimeout);
    }

    viewportResizeEndTimeout = window.setTimeout(() => {
      untrack(() => {
        setViewportResizeActive(false);
        viewportResizeEndTimeout = undefined;
        flushLayoutTextWidth();
      });
    }, viewportResizeEndMs);
  };

  const measureReader = (preserveScrollAnchor = false) => {
    if (!rootRef) {
      return;
    }

    if (preserveScrollAnchor) {
      lockResizeScrollAnchor();
      markViewportResize();
    }

    lastMeasuredReaderWidth =
      elementContentWidth(documentShellRef) || rootRef.getBoundingClientRect().width;
    setReaderWidth(lastMeasuredReaderWidth);
    setViewportHeight(visualViewportHeight());
    setScrollTop(documentScrollTop());
  };

  const measureReaderWidthChange = () => {
    if (!rootRef) {
      return;
    }

    const nextReaderWidth =
      elementContentWidth(documentShellRef) || rootRef.getBoundingClientRect().width;

    if (Math.abs(nextReaderWidth - lastMeasuredReaderWidth) < 0.5) {
      return;
    }

    measureReader(true);
  };

  const updateScrollPosition = () => {
    setScrollTop(documentScrollTop());
    readerNavigationHistory.updateCurrentLocation();
  };

  const applyRulerPointer = (event: PointerEvent | MouseEvent) => {
    const currentRulerElement = rulerElement();

    if (!rootRef || !currentRulerElement) {
      return;
    }

    const contentBounds = elementContentBounds(documentShellRef);

    applyWidthRulerPointer(event, {
      rulerElement: currentRulerElement,
      contentLeft: contentBounds?.left,
      contentRight: contentBounds?.right,
      availableWidth: availableTextWidth(),
      minHalfWidth: 140,
      onWidthChange: setPendingMaxTextWidth,
      onGuideX: setGuideX,
    });
  };

  const onRulerPointerDown = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLDivElement | null;

    target?.setPointerCapture(event.pointerId);
    lockedScrollAnchor = captureScrollAnchor();
    if (lockedScrollAnchor) {
      setPendingScrollAnchor(lockedScrollAnchor);
    }
    setPendingMaxTextWidth(settings().maxTextWidth);
    setDraggingWidth(true);
    applyRulerPointer(event);
  };

  const onRulerPointerMove = (event: PointerEvent) => {
    if (!draggingWidth()) {
      return;
    }

    applyRulerPointer(event);
  };

  const onRulerPointerUp = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLDivElement | null;
    const width = pendingMaxTextWidth();
    const anchor = lockedScrollAnchor;
    target?.releasePointerCapture(event.pointerId);
    updateSetting('maxTextWidth', width, true);
    flushLayoutTextWidth();
    restoreScrollAnchorAfterLayout(anchor);
    setDraggingWidth(false);
    setPendingMaxTextWidth(undefined);
    lockedScrollAnchor = undefined;
    setGuideX(undefined);
  };

  const applyAutoWidth = () => {
    // Та же механика, что при отпускании направляющих ширины за пределы экрана:
    // фиксируем якорь по текущему layout, выставляем настройку с keepLockedAnchor
    // и сразу пересчитываем ширину синхронно, пока lockedScrollAnchor ещё жив.
    // Если полагаться на асинхронный эффект textWidth, он снимет якорь повторно
    // в нестабильный момент смены layout — и позиция собьётся.
    lockedScrollAnchor = captureScrollAnchor();
    const anchor = lockedScrollAnchor;
    if (lockedScrollAnchor) {
      setPendingScrollAnchor(lockedScrollAnchor);
    }

    updateSetting('maxTextWidth', undefined, true);
    flushLayoutTextWidth();
    restoreScrollAnchorAfterLayout(anchor);
    lockedScrollAnchor = undefined;
  };

  createEffect(() => {
    void textWidth();

    if (draggingWidth()) {
      return;
    }

    if (viewportResizeActive()) {
      scheduleLayoutTextWidth();
      return;
    }

    flushLayoutTextWidth();
  });

  const flushSettingsPersist = () => {
    if (settingsPersistTimeout !== undefined) {
      window.clearTimeout(settingsPersistTimeout);
      settingsPersistTimeout = undefined;
      setReflowableReaderSettingsPreference(untrack(settings));
    }
  };

  createEffect(
    on(
      settings,
      () => {
        if (settingsPersistTimeout !== undefined) {
          window.clearTimeout(settingsPersistTimeout);
        }

        settingsPersistTimeout = window.setTimeout(flushSettingsPersist, settingsPersistDebounceMs);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const currentSettings = settings();
    void currentSettings.fontFamily;
    void currentSettings.fontSize;

    if (isReaderLayoutFontReady(currentSettings)) {
      return;
    }

    void loadReaderLayoutFonts(currentSettings).then(() => {
      untrack(() => {
        if (disposed) {
          return;
        }

        // Якорь снимаем здесь, а не при запуске эффекта: к этому моменту позиция
        // уже могла быть восстановлена из прогресса (ReaderPage.restoreScrollProgress).
        // Снятый заранее якорь фиксирует scrollY=0 и после пересчёта layout
        // отбрасывает читалку в начало книги.
        const anchor = layoutSettingsAnchor ?? fontLayoutAnchor ?? captureScrollAnchor();

        if (anchor) {
          setPendingScrollAnchor(anchor);
        }

        fontLayoutAnchor = undefined;

        // Pretext caches fallback widths even after the web font has loaded.
        clearCache();
        setLayoutGeneration((value) => value + 1);
      });
    });
  });

  onMount(() => {
    const resizeObserver = new ResizeObserver(() => measureReaderWidthChange());
    const onScroll = () => updateScrollPosition();
    const onResize = () => measureReader(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFootnote();
      }
    };
    const onFontsChanged = () => {
      const anchor = captureScrollAnchor();

      if (anchor) {
        setPendingScrollAnchor(anchor);
      }

      clearCache();
      setLayoutGeneration((value) => value + 1);
    };

    if (rootRef) {
      resizeObserver.observe(rootRef);
    }

    if (documentShellRef) {
      resizeObserver.observe(documentShellRef);
    }

    measureReader();
    flushLayoutTextWidth();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    document.fonts.addEventListener('loadingdone', onFontsChanged);
    document.fonts.addEventListener('loadingerror', onFontsChanged);

    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      document.fonts.removeEventListener('loadingdone', onFontsChanged);
      document.fonts.removeEventListener('loadingerror', onFontsChanged);
    });
  });

  createEffect(() => {
    const anchor = pendingScrollAnchor();
    const currentLayout = layout();

    if (!anchor || !documentRef) {
      return;
    }

    const blockIndex = Math.min(anchor.blockIndex, currentLayout.offsets.length - 1);

    if (blockIndex < 0) {
      setPendingScrollAnchor(undefined);
      return;
    }

    const blockTop = currentLayout.offsets[blockIndex] ?? 0;
    const documentTop = documentRef.getBoundingClientRect().top + window.scrollY;
    const nextDocumentScrollTop = blockTop + anchor.offsetPx;

    // Защита от устаревшего якоря «начало книги».
    //
    // Несколько путей (font loadingdone/loadingerror, debounce пересчёта ширины,
    // resize) снимают якорь по текущему window-скроллу асинхронно. Если в этот
    // момент позиция ещё не восстановлена из прогресса, якорь получается
    // {blockIndex: 0, offsetPx: 0}. Применение такого якоря позже отбрасывает
    // уже восстановленную позицию в начало книги.
    //
    // Легитимный «якорь = начало» идемпотентен: если читатель и так в начале,
    // повторная прокрутка в 0 ничего не меняет. Поэтому различаем ситуации по
    // реальной позиции документа: если она уже далеко от начала, а якорь
    // указывает на начало — якорь устарел, игнорируем.
    if (
      blockIndex === 0 &&
      anchor.offsetPx < 1e-6 &&
      documentScrollTop() > currentLayout.heights[0] + 1
    ) {
      setPendingScrollAnchor(undefined);
      return;
    }

    const nextScrollTop = documentTop + nextDocumentScrollTop;

    if (scrollAnchorFrame !== undefined) {
      cancelAnimationFrame(scrollAnchorFrame);
    }

    scrollAnchorFrame = requestAnimationFrame(() => {
      window.scrollTo({ top: nextScrollTop });
      setScrollTop(nextDocumentScrollTop);
      setPendingScrollAnchor(undefined);
      scrollAnchorFrame = undefined;
    });
  });

  onCleanup(() => {
    disposed = true;
    flushSettingsPersist();

    if (scrollAnchorFrame !== undefined) {
      cancelAnimationFrame(scrollAnchorFrame);
    }

    if (resizeAnchorTimeout !== undefined) {
      window.clearTimeout(resizeAnchorTimeout);
    }

    if (layoutWidthDebounceTimeout !== undefined) {
      window.clearTimeout(layoutWidthDebounceTimeout);
    }

    if (viewportResizeEndTimeout !== undefined) {
      window.clearTimeout(viewportResizeEndTimeout);
    }

    if (resetAnchorFrame !== undefined) {
      cancelAnimationFrame(resetAnchorFrame);
    }

    if (searchScrollFrame !== undefined) {
      cancelAnimationFrame(searchScrollFrame);
    }
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ''}`} style={cssVars()}>
      <ReaderChrome
        visible={readerChrome.visible()}
        title={documentTitle()}
        headerContent={props.headerContent}
        searchValue={searchValue()}
        onSearchValueChange={setSearchValue}
        searchCount={searchCount()}
        onSearchNext={() => search('next')}
        onSearchPrevious={() => search('previous')}
        bottomContent={<span>{progressPercent()}%</span>}
        scrollbarBackground={settings().backgroundColor}
        markerStyles={markerStyles()}
        availableTextWidth={availableTextWidth()}
        currentTextWidth={textWidth()}
        tocAvailable={tocAvailable()}
        settingsOpen={openPanel() === 'settings'}
        tocOpen={openPanel() === 'toc'}
        onShow={readerChrome.show}
        onSearchOpen={closePanel}
        onClose={readerChrome.close}
        onToggleSettings={() => togglePanel('settings')}
        onToggleToc={() => togglePanel('toc')}
        onRulerRef={(element) => {
          setRulerElement(element);
        }}
        onRulerPointerDown={onRulerPointerDown}
        onRulerPointerMove={onRulerPointerMove}
        onRulerPointerUp={onRulerPointerUp}
      />

      <Show when={draggingWidth() && guideX() !== undefined}>
        <div class={styles.widthGuide} style={{ left: `${guideX()}px` }} aria-hidden="true" />
      </Show>

      <SettingsPanel
        open={openPanel() === 'settings'}
        settings={settings()}
        onClose={() => {
          layoutSettingsAnchor = undefined;
          closePanel();
        }}
        onReset={() => {
          // Сброс настроек меняет layout (высоту блоков). Захватываем якорь по
          // текущему layout ДО смены настроек, чтобы после пересчёта эффект
          // pendingScrollAnchor вернул читателя на тот же видимый блок.
          const anchor = captureScrollAnchor();

          if (anchor) {
            if (resetAnchorFrame !== undefined) {
              cancelAnimationFrame(resetAnchorFrame);
            }

            // После сброса крупный текст может уменьшить документ настолько,
            // что браузер временно зажимает scrollY к нижней границе. Ставим
            // якорь после двух кадров: к этому моменту новый layout и высота
            // документа уже применены.
            setPendingScrollAnchor(undefined);
            resetAnchorFrame = requestAnimationFrame(() => {
              resetAnchorFrame = requestAnimationFrame(() => {
                setPendingScrollAnchor(anchor);
                resetAnchorFrame = undefined;
              });
            });
          }

          setSettings({
            ...defaultSettings,
            maxTextWidth: settings().maxTextWidth,
          });
        }}
        onUpdateSetting={updateSetting}
        onAutoWidth={applyAutoWidth}
        onBeginAdjustLayout={beginLayoutSettingsAdjustment}
        onEndAdjustLayout={endLayoutSettingsAdjustment}
      />

      <TocPanel
        open={openPanel() === 'toc'}
        entries={tocEntries()}
        onClose={closePanel}
        onSelect={onTocSelect}
      />

      <main
        ref={(element) => {
          documentShellRef = element;
        }}
        class={styles.documentShell}
        onPointerUp={(event) => {
          if (readerChrome.toggleOnTouch(event)) {
            event.preventDefault();
          }
        }}
        onClick={readerChrome.onDocumentClick}
      >
        <article ref={documentRef} class={styles.document} style={{ width: `${textWidth()}px` }}>
          <div style={{ height: `${topSpacer()}px` }} aria-hidden="true" />
          <For each={visibleBlockIndexes()}>
            {(index) => (
              <div class={styles.blockSlot} style={{ height: `${layout().heights[index] ?? 0}px` }}>
                <BlockView
                  block={parsed().blocks[index]}
                  imageSrc={imageSrc}
                  onInternalLink={onInternalLink}
                  onFootnoteLink={onFootnoteLink}
                  isFootnoteTarget={isFootnoteTarget}
                  searchRanges={searchRangesByBlock().get(index)}
                />
              </div>
            )}
          </For>
          <div style={{ height: `${bottomSpacer()}px` }} aria-hidden="true" />
        </article>
      </main>

      <Show when={activeFootnoteDialog()}>
        {(note) => (
          <ModalDialog
            overlayClass={styles.footnoteOverlay}
            contentClass={styles.footnoteDialog}
            ariaLabel={note().title}
            onClose={closeFootnote}
          >
            <>
              <header class={styles.footnoteHeader}>
                <h2>{note().title}</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  class={styles.footnoteCloseButton}
                  iconOnly
                  type="button"
                  aria-label={t('closeFootnote')}
                  iconStart={<X />}
                  onClick={closeFootnote}
                />
              </header>
              <div class={styles.footnoteContent}>
                <For each={note().blocks}>
                  {(block) => (
                    <div class={styles.footnoteBlock}>
                      <BlockView
                        block={block}
                        imageSrc={imageSrc}
                        onInternalLink={onFootnoteInternalLink}
                        onFootnoteLink={onFootnoteLink}
                        isFootnoteTarget={isFootnoteTarget}
                      />
                    </div>
                  )}
                </For>
              </div>
            </>
          </ModalDialog>
        )}
      </Show>
    </div>
  );
}

export default ReflowableReader;
