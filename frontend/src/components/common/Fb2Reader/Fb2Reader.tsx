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
import styles from "./Fb2Reader.module.scss";

type ScrollAnchor = {
  blockIndex: number;
  offsetRatio: number;
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
  let documentRef: HTMLElement | undefined;
  let rulerRef: HTMLDivElement | undefined;
  let scrollAnchorFrame: number | undefined;
  let lockedScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeAnchorTimeout: number | undefined;
  let layoutWidthDebounceTimeout: number | undefined;
  let viewportResizeEndTimeout: number | undefined;
  let lastMeasuredReaderWidth = 0;
  const [settings, setSettings] = createSignal<Fb2ReaderSettings>({ ...defaultSettings, ...props.initialSettings });
  const [viewportHeight, setViewportHeight] = createSignal(900);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [readerWidth, setReaderWidth] = createSignal(960);
  const [layoutTextWidth, setLayoutTextWidth] = createSignal(320);
  const [viewportResizeActive, setViewportResizeActive] = createSignal(false);
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
  const [pendingScrollAnchor, setPendingScrollAnchor] = createSignal<ScrollAnchor>();
  const [activeFootnoteId, setActiveFootnoteId] = createSignal<string>();
  const [layoutGeneration, setLayoutGeneration] = createSignal(0);
  let lastMeasuredLayout: VirtualLayout = { offsets: [], heights: [], totalHeight: 0 };
  const parsed = createMemo(() => parseFb2(props.fb2));
  const availableTextWidth = createMemo(() => Math.max(320, readerWidth() - settings().pagePadding * 2));
  const textWidth = createMemo(() => Math.min(availableTextWidth(), settings().maxTextWidth ?? availableTextWidth()));

  const currentWidthChangeAnchor = () => lockedScrollAnchor ?? resizeScrollAnchor ?? captureScrollAnchor();

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

  const layout = createMemo(() => {
    layoutGeneration();
    const currentSettings = settings();

    if (typeof document !== "undefined" && !isReaderLayoutFontReady(currentSettings)) {
      return lastMeasuredLayout;
    }

    lastMeasuredLayout = buildVirtualLayout(parsed().blocks, layoutTextWidth(), currentSettings);

    return lastMeasuredLayout;
  });
  const imageSrc = (id: string | undefined) => binaryToDataUrl(id ? parsed().binaries.get(id) : undefined);
  const rulerTicks = Array.from({ length: 81 }, (_, index) => index - 40);
  const cssVars = createMemo<CssVars>(() => ({
    "--fb2-bg": settings().backgroundColor,
    "--fb2-text": settings().textColor,
    "--fb2-link": settings().linkColor,
    "--fb2-font-family": settings().fontFamily,
    "--fb2-font-size": `${settings().fontSize}px`,
    "--fb2-line-height": String(settings().lineHeight),
    "--fb2-paragraph-indent": `${settings().paragraphIndent}px`,
    "--fb2-content-padding": `${settings().pagePadding}px`,
  }));
  const markerStyles = createMemo<{ left: JSX.CSSProperties; right: JSX.CSSProperties }>(() => {
    const maxTextWidth = settings().maxTextWidth;

    if (!maxTextWidth || !rulerRef) {
      return { left: { display: "none" }, right: { display: "none" } };
    }

    const rulerRect = rulerRef.getBoundingClientRect();
    const halfWidth = clamp(maxTextWidth / 2, 140, availableTextWidth() / 2);
    const centerX = rulerRect.width / 2;

    return {
      left: { left: `${centerX - halfWidth}px` },
      right: { left: `${centerX + halfWidth}px` },
    };
  });
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
    const blockHeight = Math.max(1, currentLayout.heights[blockIndex] ?? 1);
    const offsetRatio = clamp((currentDocumentScrollTop - blockTop) / blockHeight, 0, 1);

    return { blockIndex, offsetRatio };
  };

  const updateSetting = <T extends keyof Fb2ReaderSettings>(
    key: T,
    value: Fb2ReaderSettings[T],
    keepLockedAnchor = false,
  ) => {
    const anchor = keepLockedAnchor && lockedScrollAnchor ? lockedScrollAnchor : captureScrollAnchor();

    if (anchor) {
      setPendingScrollAnchor(anchor);
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

    lastMeasuredReaderWidth = rootRef.getBoundingClientRect().width;
    setReaderWidth(lastMeasuredReaderWidth);
    setViewportHeight(visualViewportHeight());
    setScrollTop(documentScrollTop());
  };

  const measureReaderWidthChange = () => {
    if (!rootRef) {
      return;
    }

    const nextReaderWidth = rootRef.getBoundingClientRect().width;

    if (Math.abs(nextReaderWidth - lastMeasuredReaderWidth) < 0.5) {
      return;
    }

    measureReader(true);
  };

  const updateScrollPosition = () => {
    setScrollTop(documentScrollTop());
  };

  const applyRulerPointer = (event: PointerEvent | MouseEvent) => {
    if (!rootRef || !rulerRef) {
      return;
    }

    const rootRect = rootRef.getBoundingClientRect();
    const rulerRect = rulerRef.getBoundingClientRect();
    const documentLeft = rootRect.left + settings().pagePadding;
    const documentRight = rootRect.right - settings().pagePadding;

    if (event.clientX <= documentLeft || event.clientX >= documentRight) {
      updateSetting("maxTextWidth", undefined, true);
      setGuideX(event.clientX);
      return;
    }

    const center = rulerRect.left + rulerRect.width / 2;
    const side = event.clientX < center ? -1 : 1;
    const nextHalfWidth = clamp(Math.abs(event.clientX - center), 140, availableTextWidth() / 2);
    const nextWidth = nextHalfWidth * 2;

    setGuideX(center + side * nextHalfWidth);
    updateSetting("maxTextWidth", Math.round(nextWidth), true);
  };

  const onRulerPointerDown = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLDivElement | null;

    target?.setPointerCapture(event.pointerId);
    lockedScrollAnchor = captureScrollAnchor();
    if (lockedScrollAnchor) {
      setPendingScrollAnchor(lockedScrollAnchor);
    }
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

    target?.releasePointerCapture(event.pointerId);
    flushLayoutTextWidth();
    setDraggingWidth(false);
    lockedScrollAnchor = undefined;
    setGuideX(undefined);
  };

  createEffect(() => {
    void textWidth();

    if (draggingWidth() || viewportResizeActive()) {
      scheduleLayoutTextWidth();
      return;
    }

    flushLayoutTextWidth();
  });

  createEffect(() => {
    const currentSettings = settings();
    void currentSettings.fontFamily;
    void currentSettings.fontSize;

    if (isReaderLayoutFontReady(currentSettings)) {
      return;
    }

    const anchor = captureScrollAnchor();

    void loadReaderLayoutFonts(currentSettings).then(() => {
      if (anchor) {
        setPendingScrollAnchor(anchor);
      }

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
    const blockHeight = Math.max(1, currentLayout.heights[blockIndex] ?? 1);
    const documentTop = documentRef.getBoundingClientRect().top + window.scrollY;
    const nextDocumentScrollTop = blockTop + blockHeight * anchor.offsetRatio;
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
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ""}`} style={cssVars()}>
      <ReaderChrome
        visible={headerVisible() || panelOpen() || draggingWidth()}
        title={documentTitle()}
        headerContent={props.headerContent}
        rulerTicks={rulerTicks}
        markerStyles={markerStyles()}
        availableTextWidth={availableTextWidth()}
        currentTextWidth={settings().maxTextWidth ?? availableTextWidth()}
        onShow={() => setHeaderVisible(true)}
        onToggleSettings={() => setPanelOpen((value) => !value)}
        onRulerRef={(element) => {
          rulerRef = element;
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
        onReset={() => setSettings(defaultSettings)}
        onUpdateSetting={updateSetting}
      />

      <main class={styles.documentShell}>
        <article ref={documentRef} class={styles.document} style={{ width: `${layoutTextWidth()}px` }}>
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
