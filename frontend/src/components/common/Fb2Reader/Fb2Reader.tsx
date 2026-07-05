import { createEffect, createMemo, createSignal, For, JSX, onCleanup, onMount, Show } from "solid-js";
import { X } from "lucide-solid";
import BlockView from "./BlockView/BlockView";
import Button from "@/components/common/Button/Button";
import { findBlockIndex, buildVirtualLayout } from "./fb2Layout";
import { binaryToDataUrl, parseFb2 } from "./fb2Parser";
import { defaultSettings } from "./fb2ReaderSettings";
import { CssVars, Fb2ReaderProps, Fb2ReaderSettings, RenderedBlock } from "./fb2Types";
import ReaderChrome from "./ReaderChrome/ReaderChrome";
import SettingsPanel from "./SettingsPanel/SettingsPanel";
import styles from "./Fb2Reader.module.scss";

type ScrollAnchor = {
  blockIndex: number;
  offsetRatio: number;
};

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

function Fb2Reader(props: Fb2ReaderProps) {
  let rootRef: HTMLDivElement | undefined;
  let documentRef: HTMLElement | undefined;
  let rulerRef: HTMLDivElement | undefined;
  let scrollAnchorFrame: number | undefined;
  let lockedScrollAnchor: ScrollAnchor | undefined;
  let resizeScrollAnchor: ScrollAnchor | undefined;
  let resizeAnchorTimeout: number | undefined;
  const [settings, setSettings] = createSignal<Fb2ReaderSettings>({ ...defaultSettings, ...props.initialSettings });
  const [viewportHeight, setViewportHeight] = createSignal(900);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [readerWidth, setReaderWidth] = createSignal(960);
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
  const [pendingScrollAnchor, setPendingScrollAnchor] = createSignal<ScrollAnchor>();
  const [activeFootnoteId, setActiveFootnoteId] = createSignal<string>();
  const parsed = createMemo(() => parseFb2(props.fb2));
  const availableTextWidth = createMemo(() => Math.max(320, readerWidth() - settings().pagePadding * 2));
  const textWidth = createMemo(() => Math.min(availableTextWidth(), settings().maxTextWidth ?? availableTextWidth()));
  const layout = createMemo(() => buildVirtualLayout(parsed().blocks, textWidth(), settings()));
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

  const measureReader = (preserveScrollAnchor = false) => {
    if (!rootRef) {
      return;
    }

    if (preserveScrollAnchor) {
      lockResizeScrollAnchor();
    }

    setReaderWidth(rootRef.clientWidth);
    setViewportHeight(window.innerHeight);
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
    setDraggingWidth(false);
    lockedScrollAnchor = undefined;
    setGuideX(undefined);
  };

  onMount(() => {
    const resizeObserver = new ResizeObserver(() => measureReader(true));
    const onScroll = () => measureReader();
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

    if (rootRef) {
      resizeObserver.observe(rootRef);
    }

    measureReader();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointermove", onPointerMove);

    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onPointerMove);
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
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ""}`} style={cssVars()}>
      <div class={styles.hoverZone} aria-hidden="true" />
      <ReaderChrome
        visible={headerVisible() || panelOpen() || draggingWidth()}
        title={documentTitle()}
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

      <Show when={activeFootnote()}>
        {(note) => (
          <div
            class={styles.footnoteOverlay}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeFootnote();
              }
            }}
          >
            <section class={styles.footnoteDialog} role="dialog" aria-modal="true" aria-label="Сноска">
              <header class={styles.footnoteHeader}>
                <h2>Сноска</h2>
                <Button
                  variant="ghost"
                  size="sm"
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
