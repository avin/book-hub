import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { X } from "lucide-solid";
import BlockView from "./BlockView/BlockView";
import Button from "@/components/common/Button/Button";
import { findBlockIndex, buildVirtualLayout } from "./fb2Layout";
import { isReaderLayoutFontReady, loadReaderLayoutFonts } from "./fb2FontMetrics";
import { binaryToDataUrl, parseFb2 } from "./fb2Parser";
import { defaultSettings } from "./fb2ReaderSettings";
import type {
  CssVars,
  Fb2Block,
  Fb2Inline,
  Fb2Note,
  Fb2ReaderSettings,
  RenderedBlock,
  VirtualLayout,
} from "./fb2Types";
import ReaderChrome from "./ReaderChrome/ReaderChrome";
import SettingsPanel from "./SettingsPanel/SettingsPanel";
import { applyWidthRulerPointer, computeWidthRulerMarkers } from "@/components/common/WidthRuler/widthRulerUtils";
import { getFb2ReaderSettingsPreference, setFb2ReaderSettingsPreference } from "@/storage/browserPreferences";
import styles from "./Fb2Reader.module.scss";

type ScrollAnchor = {
  blockIndex: number;
  offsetPx: number;
};

const layoutWidthDebounceMs = 120;
const viewportResizeEndMs = 150;

function visualViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function settingValue<T extends keyof Fb2ReaderSettings>(
  settings: Fb2ReaderSettings,
  key: T,
  value: Fb2ReaderSettings[T],
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

function inlineText(inlines: Fb2Inline[] | undefined): string {
  return (
    inlines
      ?.map((inline) => inline.text ?? inlineText(inline.children))
      .join("")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function splitFootnote(note: Fb2Note | undefined): { title: string; blocks: Fb2Block[] } | undefined {
  if (!note) {
    return undefined;
  }

  const titleParts: string[] = [];
  let contentStartIndex = 0;

  while (
    contentStartIndex < note.blocks.length &&
    (note.blocks[contentStartIndex].kind === "title" || note.blocks[contentStartIndex].kind === "subtitle")
  ) {
    const text = inlineText(note.blocks[contentStartIndex].inlines);

    if (text) {
      titleParts.push(text);
    }

    contentStartIndex += 1;
  }

  const title = titleParts.join(" ");

  return {
    title: title || "Сноска",
    blocks: note.blocks.slice(contentStartIndex),
  };
}

function Fb2Reader(props: {
  fb2: string;
  class?: string;
  initialSettings?: Partial<Fb2ReaderSettings>;
  headerContent?: JSX.Element;
}) {
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
  let lastMeasuredReaderWidth = 0;
  let disposed = false;
  const [settings, setSettings] = createSignal<Fb2ReaderSettings>({
    ...defaultSettings,
    ...getFb2ReaderSettingsPreference(),
    ...props.initialSettings,
  });
  const [viewportHeight, setViewportHeight] = createSignal(900);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [readerWidth, setReaderWidth] = createSignal(960);
  const [layoutTextWidth, setLayoutTextWidth] = createSignal(320);
  const [viewportResizeActive, setViewportResizeActive] = createSignal(false);
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
  const [pendingMaxTextWidth, setPendingMaxTextWidth] = createSignal<number | undefined>();
  const [adjustingLayoutSettings, setAdjustingLayoutSettings] = createSignal(false);
  const [pendingScrollAnchor, setPendingScrollAnchor] = createSignal<ScrollAnchor>();
  const [activeFootnoteId, setActiveFootnoteId] = createSignal<string>();
  const [layoutGeneration, setLayoutGeneration] = createSignal(0);
  const [rulerElement, setRulerElement] = createSignal<HTMLDivElement>();
  let lastMeasuredLayout: VirtualLayout = { offsets: [], heights: [], totalHeight: 0 };
  const parsed = createMemo(() => parseFb2(props.fb2));
  const availableTextWidth = createMemo(() => readerWidth());
  const effectiveMaxTextWidth = createMemo(() =>
    draggingWidth() ? pendingMaxTextWidth() : settings().maxTextWidth,
  );
  const textWidth = createMemo(() => Math.min(availableTextWidth(), effectiveMaxTextWidth() ?? availableTextWidth()));

  const currentWidthChangeAnchor = () => lockedScrollAnchor ?? resizeScrollAnchor ?? captureScrollAnchor();

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
        const nextScrollTop = documentTop + (currentLayout.offsets[blockIndex] ?? 0) + anchor.offsetPx;

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
      applyLayoutTextWidth(anchor);
      layoutWidthDebounceTimeout = undefined;
    }, layoutWidthDebounceMs);
  };

  let frozenLayoutSettings: Fb2ReaderSettings | undefined;
  const layoutSettings = createMemo(() => {
    const s = settings();

    if (adjustingLayoutSettings() && frozenLayoutSettings) {
      return frozenLayoutSettings;
    }

    frozenLayoutSettings = s;
    return s;
  }, undefined, {
    equals: (prev, next) =>
      !!prev &&
      prev.fontFamily === next.fontFamily &&
      prev.fontSize === next.fontSize &&
      prev.lineHeight === next.lineHeight &&
      prev.paragraphSpacing === next.paragraphSpacing &&
      prev.paragraphIndent === next.paragraphIndent,
  });

  const layout = createMemo(() => {
    layoutGeneration();
    const currentSettings = layoutSettings();

    if (typeof document !== "undefined" && !isReaderLayoutFontReady(currentSettings)) {
      return lastMeasuredLayout;
    }

    lastMeasuredLayout = buildVirtualLayout(parsed().blocks, layoutTextWidth(), currentSettings);

    return lastMeasuredLayout;
  });
  const imageSrc = (id: string | undefined) => binaryToDataUrl(id ? parsed().binaries.get(id) : undefined);
  const cssVars = createMemo<CssVars>(() => ({
    "--fb2-bg": settings().backgroundColor,
    "--fb2-text": settings().textColor,
    "--fb2-link": settings().linkColor,
    "--fb2-font-family": settings().fontFamily,
    "--fb2-font-size": `${settings().fontSize}px`,
    "--fb2-line-height": String(settings().lineHeight),
    "--fb2-paragraph-indent": `${settings().paragraphIndent}px`,
  }));
  const markerStyles = createMemo<{ left: JSX.CSSProperties; right: JSX.CSSProperties }>(() =>
    computeWidthRulerMarkers(rulerElement(), effectiveMaxTextWidth(), availableTextWidth()),
  );
  const visibleBlocks = createMemo<RenderedBlock[]>(() => {
    const currentLayout = layout();
    const blocks = parsed().blocks;
    const overscan = 1000;
    const start = findBlockIndex(currentLayout.offsets, Math.max(0, scrollTop() - overscan));
    const endLimit = scrollTop() + viewportHeight() + overscan;
    let end = start;

    while (end < blocks.length && currentLayout.offsets[end] < endLimit) {
      end += 1;
    }

    return blocks.slice(start, end).map((block, offset) => {
      const index = start + offset;

      return { block, index, height: currentLayout.heights[index] ?? 0 };
    });
  });
  const topSpacer = createMemo(() => {
    const first = visibleBlocks()[0];

    return first ? layout().offsets[first.index] : 0;
  });
  const bottomSpacer = createMemo(() => {
    const last = visibleBlocks()[visibleBlocks().length - 1];

    if (!last) {
      return layout().totalHeight;
    }

    return Math.max(0, layout().totalHeight - layout().offsets[last.index] - last.height);
  });
  const documentTitle = createMemo(() => {
    const authors = parsed().authors.join(", ");

    return [parsed().title, authors].filter(Boolean).join(" · ") || "FB2";
  });
  const activeFootnote = createMemo(() => {
    const id = activeFootnoteId();

    return id ? parsed().notes.get(id) : undefined;
  });
  const activeFootnoteDialog = createMemo(() => splitFootnote(activeFootnote()));
  const anchorIndex = createMemo(() => {
    const index = new Map<string, number>();

    parsed().blocks.forEach((block, blockIndex) => {
      if (block.sourceId && !index.has(block.sourceId)) {
        index.set(block.sourceId, blockIndex);
      }
    });

    return index;
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

  const updateSetting = <T extends keyof Fb2ReaderSettings>(
    key: T,
    value: Fb2ReaderSettings[T],
    keepLockedAnchor = false,
  ) => {
    const anchor = keepLockedAnchor && lockedScrollAnchor
      ? lockedScrollAnchor
      : layoutSettingsAnchor ?? captureScrollAnchor();

    if (anchor) {
      setPendingScrollAnchor(anchor);

      if (key === "fontFamily" || key === "fontSize") {
        fontLayoutAnchor ??= anchor;
      }
    }

    setSettings((current) => settingValue(current, key, value));
  };

  const scrollToBlockIndex = (blockIndex: number) => {
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

    window.scrollTo({ top: nextScrollTop, behavior: "smooth" });
    setScrollTop(blockTop);
  };

  const onInternalLink = (targetId: string) => {
    const blockIndex = anchorIndex().get(targetId);

    if (blockIndex === undefined) {
      return;
    }

    scrollToBlockIndex(blockIndex);
  };

  const beginLayoutSettingsAdjustment = () => {
    layoutSettingsAnchor = captureScrollAnchor();

    if (layoutSettingsAnchor) {
      setPendingScrollAnchor(layoutSettingsAnchor);
    }

    setAdjustingLayoutSettings(true);
  };

  const endLayoutSettingsAdjustment = () => {
    const anchor = layoutSettingsAnchor;

    setAdjustingLayoutSettings(false);
    layoutSettingsAnchor = undefined;
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
      setViewportResizeActive(false);
      viewportResizeEndTimeout = undefined;
      flushLayoutTextWidth();
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

    lastMeasuredReaderWidth = elementContentWidth(documentShellRef) || rootRef.getBoundingClientRect().width;
    setReaderWidth(lastMeasuredReaderWidth);
    setViewportHeight(visualViewportHeight());
    setScrollTop(documentScrollTop());
  };

  const measureReaderWidthChange = () => {
    if (!rootRef) {
      return;
    }

    const nextReaderWidth = elementContentWidth(documentShellRef) || rootRef.getBoundingClientRect().width;

    if (Math.abs(nextReaderWidth - lastMeasuredReaderWidth) < 0.5) {
      return;
    }

    measureReader(true);
  };

  const updateScrollPosition = () => {
    setScrollTop(documentScrollTop());
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
    updateSetting("maxTextWidth", width, true);
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

    updateSetting("maxTextWidth", undefined, true);
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

  createEffect(() => {
    setFb2ReaderSettingsPreference(settings());
  });

  createEffect(() => {
    const currentSettings = settings();
    void currentSettings.fontFamily;
    void currentSettings.fontSize;

    if (isReaderLayoutFontReady(currentSettings)) {
      return;
    }

    void loadReaderLayoutFonts(currentSettings).then(() => {
      if (disposed) {
        return;
      }

      // Якорь снимаем здесь, а не при запуске эффекта: к этому моменту позиция
      // уже могла быть восстановлена из прогресса (ReaderPage.restoreScrollProgress).
      // Снятый заранее якорь фиксирует scrollY=0 и после пересчёта layout
      // отбрасывает читалку в начало книги.
      const anchor = fontLayoutAnchor ?? captureScrollAnchor();

      if (anchor) {
        setPendingScrollAnchor(anchor);
      }

      fontLayoutAnchor = undefined;

      setLayoutGeneration((value) => value + 1);
    });
  });

  onMount(() => {
    const resizeObserver = new ResizeObserver(() => measureReaderWidthChange());
    const onScroll = () => updateScrollPosition();
    const onResize = () => measureReader(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFootnote();
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientY < 88) {
        setHeaderVisible(true);
      } else if (event.clientY > 164 && !panelOpen() && !draggingWidth()) {
        setHeaderVisible(false);
      }
    };
    const onFontsChanged = () => {
      const anchor = captureScrollAnchor();

      if (anchor) {
        setPendingScrollAnchor(anchor);
      }

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
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointermove", onPointerMove);
    document.fonts.addEventListener("loadingdone", onFontsChanged);
    document.fonts.addEventListener("loadingerror", onFontsChanged);

    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onPointerMove);
      document.fonts.removeEventListener("loadingdone", onFontsChanged);
      document.fonts.removeEventListener("loadingerror", onFontsChanged);
    });
  });

  createEffect(() => {
    if (panelOpen()) {
      setHeaderVisible(true);
    }
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
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ""}`} style={cssVars()}>
      <ReaderChrome
        visible={headerVisible() || panelOpen() || draggingWidth()}
        title={documentTitle()}
        headerContent={props.headerContent}
        markerStyles={markerStyles()}
        availableTextWidth={availableTextWidth()}
        currentTextWidth={textWidth()}
        onShow={() => setHeaderVisible(true)}
        onToggleSettings={() => setPanelOpen((value) => !value)}
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
        open={panelOpen()}
        settings={settings()}
        onClose={() => setPanelOpen(false)}
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

          setSettings(defaultSettings);
        }}
        onUpdateSetting={updateSetting}
        onAutoWidth={applyAutoWidth}
        onBeginAdjustLayout={beginLayoutSettingsAdjustment}
        onEndAdjustLayout={endLayoutSettingsAdjustment}
      />

      <main
        ref={(element) => {
          documentShellRef = element;
        }}
        class={styles.documentShell}
      >
        <article ref={documentRef} class={styles.document} style={{ width: `${textWidth()}px` }}>
          <div style={{ height: `${topSpacer()}px` }} aria-hidden="true" />
          <For each={visibleBlocks()}>
            {(item) => (
              <div class={styles.blockSlot} style={{ height: `${item.height}px` }}>
                <BlockView
                  block={item.block}
                  imageSrc={imageSrc}
                  onInternalLink={onInternalLink}
                  onFootnoteLink={onFootnoteLink}
                  isFootnoteTarget={isFootnoteTarget}
                />
              </div>
            )}
          </For>
          <div style={{ height: `${bottomSpacer()}px` }} aria-hidden="true" />
        </article>
      </main>

      <Show when={activeFootnoteDialog()}>
        {(note) => (
          <div
            class={styles.footnoteOverlay}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeFootnote();
              }
            }}
          >
            <section class={styles.footnoteDialog} role="dialog" aria-modal="true" aria-label={note().title}>
              <header class={styles.footnoteHeader}>
                <h2>{note().title}</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  class={styles.footnoteCloseButton}
                  iconOnly
                  type="button"
                  aria-label="Закрыть сноску"
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
            </section>
          </div>
        )}
      </Show>
    </div>
  );
}

export default Fb2Reader;
