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
  getFixedLayoutReaderPageWidthOverflowPreference,
  setFixedLayoutReaderContentWidthPreference,
  setFixedLayoutReaderFilterChainPreference,
  setFixedLayoutReaderPageWidthOverflowPreference,
} from '@/storage/browserPreferences';
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
import { isPdfWebglAvailable, renderPdfPageFilter } from '../PdfReader/pdfWebglFilter';
import styles from '../PdfReader/PdfReader.module.scss';

type Page = { pageNumber: number; width: number; height: number };
type SearchMatch = { pageNumber: number; zoneIndex: number };

const documentPaddingX = 20;
const minPageWidth = 240;
const minPageHalfWidth = 120;
const maxPixelRatio = 2;

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
  const pageRefs = new Map<number, HTMLElement>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();
  const filteredCanvasRefs = new Map<number, HTMLCanvasElement>();
  const textLayerRefs = new Map<number, HTMLDivElement>();
  const textByPage = new Map<number, DjVuTextZone[]>();
  const renderedKeys = new Map<number, string>();
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
  const [searchAvailable, setSearchAvailable] = createSignal(false);
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

  const measure = () => {
    if (!rootRef) return;
    setDocumentWidth(Math.round(rootRef.clientWidth - documentPaddingX * 2));
  };

  const renderTextLayer = (pageNumber: number) => {
    const layer = textLayerRefs.get(pageNumber);
    const page = pages().find((item) => item.pageNumber === pageNumber);
    const zones = textByPage.get(pageNumber);

    if (!layer || !page || !zones) return;

    const query = searchValue().trim().toLocaleLowerCase();
    const selected = searchMatches()[selectedMatch()];
    layer.textContent = '';

    zones.forEach((zone, zoneIndex) => {
      if (!zone.text) return;
      const span = document.createElement('span');
      const matches = query.length > 0 && zone.text.toLocaleLowerCase().includes(query);
      span.textContent = zone.text;
      span.style.left = `${(zone.x / page.width) * 100}%`;
      span.style.top = `${(zone.y / page.height) * 100}%`;
      span.style.width = `${(zone.width / page.width) * 100}%`;
      span.style.height = `${(zone.height / page.height) * 100}%`;
      span.style.fontSize = `${Math.max(1, (zone.height / page.height) * pageHeight(page))}px`;
      if (matches) {
        span.className = `highlight${selected?.pageNumber === pageNumber && selected.zoneIndex === zoneIndex ? ' selected' : ''}`;
      }
      layer.append(span);
    });
  };

  const renderPage = async (page: Page) => {
    const activeWorker = worker;
    const canvas = canvasRefs.get(page.pageNumber);
    const pageElement = pageRefs.get(page.pageNumber);

    if (!activeWorker || !canvas || !pageElement) return;
    const width = Math.round(pageElement.clientWidth);
    const key = `${width}:${renderPixelRatio()}`;

    if (renderedKeys.get(page.pageNumber) !== key) {
      const pageImage = await activeWorker.doc.getPage(page.pageNumber).createPngObjectUrl().run();
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const nextImage = new Image();
          nextImage.onload = () => resolve(nextImage);
          nextImage.onerror = () => reject(new Error('DJVU page image could not be decoded'));
          nextImage.src = pageImage.url;
        });
        if (destroyed || activeWorker !== worker) return;
        const ratio = renderPixelRatio();
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(canvas.width * (page.height / page.width)));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.round(width * (page.height / page.width))}px`;
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        renderedKeys.set(page.pageNumber, key);
      } finally {
        activeWorker.revokeObjectURL(pageImage.url);
      }
    }

    const filteredCanvas = filteredCanvasRefs.get(page.pageNumber);
    if (filtersEnabled() && filteredCanvas) {
      try {
        renderPdfPageFilter(canvas, filteredCanvas, filterChain());
        filteredCanvas.style.width = canvas.style.width;
        filteredCanvas.style.height = canvas.style.height;
        filteredCanvas.classList.add(styles.filteredCanvasVisible);
      } catch {
        setFilterError('pdfFiltersUnavailable');
      }
    } else if (filteredCanvas) {
      filteredCanvas.classList.remove(styles.filteredCanvasVisible);
    }

    if (!textByPage.has(page.pageNumber)) {
      const zones =
        (await activeWorker.doc.getPage(page.pageNumber).getNormalizedTextZones().run()) ?? [];
      if (!destroyed && activeWorker === worker) textByPage.set(page.pageNumber, zones);
    }
    renderTextLayer(page.pageNumber);
  };

  const refreshVisiblePages = () => {
    renderedKeys.clear();
    for (const page of pages()) {
      if (visiblePages().has(page.pageNumber)) void renderPage(page);
    }
  };

  const loadDocument = async () => {
    const loadGeneration = ++generation;
    worker?.worker.terminate();
    worker = undefined;
    setLoading(true);
    setFailed(false);
    setPages([]);
    setOutline([]);
    setOutlineLoaded(false);
    setSearchAvailable(false);
    textByPage.clear();
    renderedKeys.clear();
    tocTargets.clear();
    try {
      const nextWorker = await createDjVuWorker();
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
      void (async () => {
        for (let pageNumber = 1; pageNumber <= sizes.length; pageNumber += 1) {
          const text = await nextWorker.doc.getPage(pageNumber).getText().run();
          if (loadGeneration !== generation || destroyed) {
            return;
          }
          if (text?.trim()) {
            setSearchAvailable(true);
            return;
          }
        }
      })();
      requestAnimationFrame(() => props.onReady?.());
    } catch (error) {
      console.error('Could not open DJVU', error);
      if (loadGeneration === generation && !destroyed) {
        setLoading(false);
        setFailed(true);
      }
    }
  };

  const search = async (direction: 1 | -1) => {
    const query = searchValue().trim().toLocaleLowerCase();
    if (!query || !worker) {
      setSearchMatches([]);
      setSelectedMatch(-1);
      return;
    }
    const matches: SearchMatch[] = [];
    for (const page of pages()) {
      let zones = textByPage.get(page.pageNumber);
      if (!zones) {
        zones = (await worker.doc.getPage(page.pageNumber).getNormalizedTextZones().run()) ?? [];
        textByPage.set(page.pageNumber, zones);
      }
      zones.forEach((zone, zoneIndex) => {
        if (zone.text.toLocaleLowerCase().includes(query))
          matches.push({ pageNumber: page.pageNumber, zoneIndex });
      });
    }
    setSearchMatches(matches);
    const nextIndex = matches.length
      ? (selectedMatch() + direction + matches.length) % matches.length
      : -1;
    setSelectedMatch(nextIndex);
    const selected = matches[nextIndex];
    if (selected) pageRefs.get(selected.pageNumber)?.scrollIntoView({ block: 'center' });
    for (const page of pages()) renderTextLayer(page.pageNumber);
  };

  const selectToc = async (entry: TocEntry) => {
    const target = tocTargets.get(entry);
    if (!target) return;
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    const pageNumber = await worker?.doc.getPageNumberByUrl(target).run();
    if (pageNumber) pageRefs.get(pageNumber)?.scrollIntoView({ block: 'start' });
    setTocOpen(false);
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
    setMaxWidth(width);
    setFixedLayoutReaderContentWidthPreference(width);
    refreshVisiblePages();
  };
  const updateOverflow = (value: number) => {
    const next = clampPdfPageWidthOverflow(value);
    setOverflow(next);
    setFixedLayoutReaderPageWidthOverflowPreference(props.bookId ?? props.fileUrl, next);
    refreshVisiblePages();
  };

  const readerChrome = useReaderChrome({
    keepVisible: () => tocOpen() || filterPanelOpen(),
    onClose: () => {
      setTocOpen(false);
      setFilterPanelOpen(false);
    },
  });

  createEffect(() => {
    const current = visiblePages();
    for (const page of pages()) if (current.has(page.pageNumber)) void renderPage(page);
  });
  createEffect(() => {
    void props.fileUrl;
    void loadDocument();
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
    window.addEventListener('scroll', syncCurrentPage, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', syncCurrentPage));
  });
  createEffect(() => {
    pages();
    requestAnimationFrame(() => pageRefs.forEach((element) => observer?.observe(element)));
  });
  onCleanup(() => {
    destroyed = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    worker?.worker.terminate();
  });

  return (
    <div ref={rootRef} class={`${styles.reader} ${props.class ?? ''}`}>
      <ReaderFloatingChrome
        visible={readerChrome.visible()}
        title={props.title}
        headerContent={props.headerContent}
        searchValue={searchAvailable() ? searchValue() : undefined}
        searchCount={searchAvailable() ? searchCount() : undefined}
        onSearchValueChange={(value) => {
          setSearchValue(value);
          setSelectedMatch(-1);
          void search(1);
        }}
        onSearchNext={() => void search(1)}
        onSearchPrevious={() => void search(-1)}
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
              onClick={() => setFilterPanelOpen(!filterPanelOpen())}
            />
            <Button
              variant="secondary"
              type="button"
              iconOnly
              iconStart={<ListTree />}
              title={outline().length ? 'Оглавление' : 'Оглавление недоступно'}
              aria-label={outline().length ? 'Оглавление' : 'Оглавление недоступно'}
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
            ariaLabel="Ширина страницы"
            minWidth={minPageWidth}
            onRulerRef={setRulerElement}
            onPointerDown={(event) => {
              const ruler = rulerElement();
              if (!ruler) return;
              const half = clampWidth(
                Math.abs(
                  event.clientX - (ruler.getBoundingClientRect().left + ruler.clientWidth / 2),
                ),
                minPageHalfWidth,
                ruler.clientWidth / 2,
              );
              updateWidth(Math.round(half * 2));
            }}
            onPointerMove={() => undefined}
            onPointerUp={() => undefined}
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
              onBlur={() => {
                const page = Number(pageInput());
                if (Number.isInteger(page))
                  pageRefs
                    .get(Math.min(Math.max(page, 1), pages().length))
                    ?.scrollIntoView({ block: 'start' });
              }}
            />
            <span>/ {pages().length}</span>
          </label>
        }
      />
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
        onAutoWidth={() => updateWidth(undefined)}
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
