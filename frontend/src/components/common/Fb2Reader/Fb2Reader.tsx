import { AlignLeft, Palette, RotateCcw, Settings, SlidersHorizontal, Type, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { findBlockIndex, buildVirtualLayout } from "./fb2Layout";
import { binaryToDataUrl, parseFb2 } from "./fb2Parser";
import {
  CssVars,
  Fb2Block,
  Fb2Inline,
  Fb2ReaderProps,
  Fb2ReaderSettings,
  Fb2TableCell,
  RenderedBlock,
} from "./fb2Types";
import styles from "./Fb2Reader.module.scss";

const defaultSettings: Fb2ReaderSettings = {
  backgroundColor: "#f7f3ea",
  textColor: "#211f1b",
  linkColor: "#24527a",
  fontFamily: "Georgia, serif",
  fontSize: 19,
  lineHeight: 1.62,
  paragraphSpacing: 14,
  paragraphIndent: 28,
  pagePadding: 56,
};

const fontOptions = [
  "Georgia, serif",
  "Inter, sans-serif",
  "Arial, sans-serif",
  "Times New Roman, serif",
  "Verdana, sans-serif",
];

function safeHref(href: string | undefined) {
  if (!href) {
    return undefined;
  }

  if (href.startsWith("#") || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
    return href;
  }

  return `#${href}`;
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

function RenderInlines(props: { inlines: Fb2Inline[] | undefined; imageSrc: (id: string | undefined) => string | undefined }) {
  return (
    <For each={props.inlines ?? []}>
      {(inline) => (
        <Switch fallback={<RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />}>
          <Match when={inline.kind === "text"}>{inline.text}</Match>
          <Match when={inline.kind === "strong"}>
            <strong>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </strong>
          </Match>
          <Match when={inline.kind === "emphasis"}>
            <em>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </em>
          </Match>
          <Match when={inline.kind === "strikethrough"}>
            <s>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </s>
          </Match>
          <Match when={inline.kind === "sub"}>
            <sub>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </sub>
          </Match>
          <Match when={inline.kind === "sup"}>
            <sup>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </sup>
          </Match>
          <Match when={inline.kind === "code"}>
            <code>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </code>
          </Match>
          <Match when={inline.kind === "link"}>
            <a href={safeHref(inline.href)}>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </a>
          </Match>
          <Match when={inline.kind === "style"}>
            <span data-fb2-style={inline.styleName}>
              <RenderInlines inlines={inline.children} imageSrc={props.imageSrc} />
            </span>
          </Match>
          <Match when={inline.kind === "image"}>
            <Show when={props.imageSrc(inline.imageId)}>
              {(src) => <img class={styles.inlineImage} src={src()} alt="" loading="lazy" />}
            </Show>
          </Match>
        </Switch>
      )}
    </For>
  );
}

function TableCell(props: { cell: Fb2TableCell; imageSrc: (id: string | undefined) => string | undefined }) {
  const content = () => <RenderInlines inlines={props.cell.inlines} imageSrc={props.imageSrc} />;

  return (
    <Show
      when={props.cell.header}
      fallback={
        <td colSpan={props.cell.colspan} rowSpan={props.cell.rowspan}>
          {content()}
        </td>
      }
    >
      <th colSpan={props.cell.colspan} rowSpan={props.cell.rowspan}>
        {content()}
      </th>
    </Show>
  );
}

function BlockView(props: { block: Fb2Block; imageSrc: (id: string | undefined) => string | undefined }) {
  return (
    <Switch>
      <Match when={props.block.kind === "title"}>
        <h2 class={styles.title} data-level={props.block.level}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} />
        </h2>
      </Match>
      <Match when={props.block.kind === "subtitle"}>
        <h3 class={styles.subtitle}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} />
        </h3>
      </Match>
      <Match when={props.block.kind === "paragraph"}>
        <p
          class={styles.paragraph}
          classList={{
            [styles.annotation]: props.block.role === "annotation" || props.block.role === "metadata",
            [styles.quote]: props.block.role === "cite" || props.block.role === "epigraph",
          }}
        >
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} />
        </p>
      </Match>
      <Match when={props.block.kind === "poemLine"}>
        <p class={styles.poemLine}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} />
        </p>
      </Match>
      <Match when={props.block.kind === "textAuthor"}>
        <p class={styles.textAuthor}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} />
        </p>
      </Match>
      <Match when={props.block.kind === "date"}>
        <p class={styles.date}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} />
        </p>
      </Match>
      <Match when={props.block.kind === "emptyLine"}>
        <div class={styles.emptyLine} aria-hidden="true" />
      </Match>
      <Match when={props.block.kind === "image"}>
        <figure class={styles.figure}>
          <Show when={props.imageSrc(props.block.imageId)} fallback={<div class={styles.missingImage}>Нет изображения</div>}>
            {(src) => <img src={src()} alt="" loading="lazy" />}
          </Show>
        </figure>
      </Match>
      <Match when={props.block.kind === "table"}>
        <div class={styles.tableScroller}>
          <table>
            <tbody>
              <For each={props.block.rows ?? []}>
                {(row) => (
                  <tr>
                    <For each={row.cells}>{(cell) => <TableCell cell={cell} imageSrc={props.imageSrc} />}</For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Match>
    </Switch>
  );
}

function SettingRow(props: { label: string; value?: string; children: JSX.Element }) {
  return (
    <label class={styles.settingRow}>
      <span>
        {props.label}
        <Show when={props.value}>
          <b>{props.value}</b>
        </Show>
      </span>
      {props.children}
    </label>
  );
}

function Fb2Reader(props: Fb2ReaderProps) {
  let rootRef: HTMLDivElement | undefined;
  let rulerRef: HTMLDivElement | undefined;
  const [settings, setSettings] = createSignal<Fb2ReaderSettings>({ ...defaultSettings, ...props.initialSettings });
  const [viewportHeight, setViewportHeight] = createSignal(900);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [readerWidth, setReaderWidth] = createSignal(960);
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  const [guideX, setGuideX] = createSignal<number | undefined>();
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

  const updateSetting = <T extends keyof Fb2ReaderSettings>(key: T, value: Fb2ReaderSettings[T]) => {
    setSettings((current) => settingValue(current, key, value));
  };

  const measureReader = () => {
    if (!rootRef) {
      return;
    }

    const rootTop = rootRef.getBoundingClientRect().top + window.scrollY;

    setReaderWidth(rootRef.clientWidth);
    setViewportHeight(window.innerHeight);
    setScrollTop(Math.max(0, window.scrollY - rootTop));
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
      updateSetting("maxTextWidth", undefined);
      setGuideX(event.clientX);
      return;
    }

    const center = rulerRect.left + rulerRect.width / 2;
    const side = event.clientX < center ? -1 : 1;
    const nextHalfWidth = clamp(Math.abs(event.clientX - center), 140, availableTextWidth() / 2);
    const nextWidth = nextHalfWidth * 2;

    setGuideX(center + side * nextHalfWidth);
    updateSetting("maxTextWidth", Math.round(nextWidth));
  };

  const onRulerPointerDown = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLDivElement | null;

    target?.setPointerCapture(event.pointerId);
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
    setGuideX(undefined);
  };

  onMount(() => {
    const resizeObserver = new ResizeObserver(measureReader);
    const onScroll = () => measureReader();
    const onResize = () => measureReader();
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
    window.addEventListener("pointermove", onPointerMove);

    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
    });
  });

  createEffect(() => {
    if (panelOpen()) {
      setHeaderVisible(true);
    }
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ""}`} style={cssVars()}>
      <div class={styles.hoverZone} aria-hidden="true" />
      <header
        class={styles.header}
        classList={{ [styles.visible]: headerVisible() || panelOpen() || draggingWidth() }}
        onPointerEnter={() => setHeaderVisible(true)}
      >
        <div class={styles.headerBar}>
          <div class={styles.bookTitle}>{documentTitle()}</div>
          <button
            class={styles.iconButton}
            type="button"
            title="Настройки внешнего вида"
            aria-label="Настройки внешнего вида"
            onClick={() => setPanelOpen((value) => !value)}
          >
            <Settings size={19} />
          </button>
        </div>
      </header>

      <div
        class={styles.rulerBar}
        classList={{ [styles.visible]: headerVisible() || panelOpen() || draggingWidth() }}
        onPointerEnter={() => setHeaderVisible(true)}
      >
        <div
          ref={rulerRef}
          class={styles.ruler}
          role="slider"
          aria-label="Максимальная ширина текста"
          aria-valuemin="280"
          aria-valuemax={Math.round(availableTextWidth())}
          aria-valuenow={Math.round(settings().maxTextWidth ?? availableTextWidth())}
          tabIndex={0}
          onPointerDown={onRulerPointerDown}
          onPointerMove={onRulerPointerMove}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={onRulerPointerUp}
        >
          <For each={rulerTicks}>
            {(tick) => (
              <span
                class={styles.rulerTick}
                classList={{
                  [styles.majorTick]: tick % 10 === 0,
                  [styles.middleTick]: tick % 5 === 0,
                  [styles.centerTick]: tick === 0,
                }}
                style={{ left: `${50 + tick * 1.25}%` }}
              />
            )}
          </For>
          <span class={styles.rulerMarker} style={markerStyles().left} />
          <span class={styles.rulerMarker} style={markerStyles().right} />
        </div>
      </div>

      <Show when={draggingWidth() && guideX() !== undefined}>
        <div class={styles.widthGuide} style={{ left: `${guideX()}px` }} aria-hidden="true" />
      </Show>

      <aside class={styles.settingsPanel} classList={{ [styles.panelOpen]: panelOpen() }}>
        <div class={styles.panelHeader}>
          <h2>Внешний вид</h2>
          <button class={styles.iconButton} type="button" title="Закрыть" aria-label="Закрыть" onClick={() => setPanelOpen(false)}>
            <X size={19} />
          </button>
        </div>

        <section class={styles.settingGroup}>
          <h3>
            <Type size={17} />
            Текст
          </h3>
          <SettingRow label="Шрифт">
            <select value={settings().fontFamily} onInput={(event) => updateSetting("fontFamily", event.currentTarget.value)}>
              <For each={fontOptions}>{(font) => <option value={font}>{font}</option>}</For>
            </select>
          </SettingRow>
          <SettingRow label="Размер" value={`${settings().fontSize}px`}>
            <input
              type="range"
              min="14"
              max="30"
              value={settings().fontSize}
              onInput={(event) => updateSetting("fontSize", Number(event.currentTarget.value))}
            />
          </SettingRow>
          <SettingRow label="Интерлиньяж" value={settings().lineHeight.toFixed(2)}>
            <input
              type="range"
              min="1.2"
              max="2.2"
              step="0.02"
              value={settings().lineHeight}
              onInput={(event) => updateSetting("lineHeight", Number(event.currentTarget.value))}
            />
          </SettingRow>
        </section>

        <section class={styles.settingGroup}>
          <h3>
            <AlignLeft size={17} />
            Абзацы
          </h3>
          <SettingRow label="Отступ первой строки" value={`${settings().paragraphIndent}px`}>
            <input
              type="range"
              min="0"
              max="64"
              value={settings().paragraphIndent}
              onInput={(event) => updateSetting("paragraphIndent", Number(event.currentTarget.value))}
            />
          </SettingRow>
          <SettingRow label="Отступ после абзаца" value={`${settings().paragraphSpacing}px`}>
            <input
              type="range"
              min="4"
              max="36"
              value={settings().paragraphSpacing}
              onInput={(event) => updateSetting("paragraphSpacing", Number(event.currentTarget.value))}
            />
          </SettingRow>
          <SettingRow label="Поля документа" value={`${settings().pagePadding}px`}>
            <input
              type="range"
              min="20"
              max="120"
              value={settings().pagePadding}
              onInput={(event) => updateSetting("pagePadding", Number(event.currentTarget.value))}
            />
          </SettingRow>
        </section>

        <section class={styles.settingGroup}>
          <h3>
            <Palette size={17} />
            Цвета
          </h3>
          <SettingRow label="Фон">
            <input
              type="color"
              value={settings().backgroundColor}
              onInput={(event) => updateSetting("backgroundColor", event.currentTarget.value)}
            />
          </SettingRow>
          <SettingRow label="Текст">
            <input type="color" value={settings().textColor} onInput={(event) => updateSetting("textColor", event.currentTarget.value)} />
          </SettingRow>
          <SettingRow label="Ссылки">
            <input type="color" value={settings().linkColor} onInput={(event) => updateSetting("linkColor", event.currentTarget.value)} />
          </SettingRow>
        </section>

        <div class={styles.panelActions}>
          <button class={styles.resetButton} type="button" onClick={() => setSettings(defaultSettings)}>
            <RotateCcw size={17} />
            Сбросить
          </button>
          <button class={styles.resetButton} type="button" onClick={() => updateSetting("maxTextWidth", undefined)}>
            <SlidersHorizontal size={17} />
            Автоширина
          </button>
        </div>
      </aside>

      <main class={styles.documentShell}>
        <article class={styles.document} style={{ width: `${textWidth()}px` }}>
          <div style={{ height: `${topSpacer()}px` }} aria-hidden="true" />
          <For each={visibleBlocks()}>
            {(item) => (
              <div class={styles.blockSlot} style={{ height: `${item.height}px` }}>
                <BlockView block={item.block} imageSrc={imageSrc} />
              </div>
            )}
          </For>
          <div style={{ height: `${bottomSpacer()}px` }} aria-hidden="true" />
        </article>
      </main>
    </div>
  );
}

export default Fb2Reader;
