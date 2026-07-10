import { createEffect, createSignal } from 'solid-js';
import {
  CHROME_HIDE_MIDDLE_PX,
  CHROME_SHOW_EDGE_PX,
  TOUCH_CLICK_GUARD_MS,
  TOUCH_TOGGLE_BOTTOM_FRACTION,
  TOUCH_TOGGLE_TOP_FRACTION,
  type ReaderSession,
  type ReaderSessionOptions,
  type ReaderSidePanel,
} from './types';

export function createReaderSession(options: ReaderSessionOptions = {}): ReaderSession {
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const [sidePanel, setSidePanel] = createSignal<ReaderSidePanel>('none');
  const [draggingWidth, setDraggingWidth] = createSignal(false);
  let ignoreNextDocumentClick = false;
  let touchToggleClickTimeout: number | undefined;

  const sidePanelOpen = () => sidePanel() !== 'none';
  const chromeVisible = () => headerVisible() || sidePanelOpen() || draggingWidth();

  createEffect(() => {
    if (sidePanelOpen()) {
      setHeaderVisible(true);
    }
  });

  const isReaderInputFocused = () => document.activeElement instanceof HTMLInputElement;

  const closePanel = () => {
    setSidePanel('none');
  };

  const togglePanel = (panel: Exclude<ReaderSidePanel, 'none'>) => {
    setSidePanel((current) => (current === panel ? 'none' : panel));
  };

  const closeChrome = () => {
    closePanel();
    setHeaderVisible(false);
    options.onChromeClose?.();
  };

  const showChrome = () => {
    setHeaderVisible(true);
  };

  const onSearchOpen = () => {
    closePanel();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (
      event.clientY < CHROME_SHOW_EDGE_PX ||
      event.clientY > window.innerHeight - CHROME_SHOW_EDGE_PX
    ) {
      setHeaderVisible(true);
      return;
    }

    if (
      event.clientY > CHROME_HIDE_MIDDLE_PX &&
      !sidePanelOpen() &&
      !draggingWidth() &&
      !isReaderInputFocused()
    ) {
      setHeaderVisible(false);
    }
  };

  const handleDocumentPointerUp = (event: PointerEvent) => {
    if (
      event.pointerType !== 'touch' ||
      event.clientY < window.innerHeight * TOUCH_TOGGLE_TOP_FRACTION ||
      event.clientY > window.innerHeight * TOUCH_TOGGLE_BOTTOM_FRACTION
    ) {
      return false;
    }

    options.onTouchToggle?.();
    setHeaderVisible((current) => !current);
    ignoreNextDocumentClick = true;

    if (touchToggleClickTimeout !== undefined) {
      window.clearTimeout(touchToggleClickTimeout);
    }

    touchToggleClickTimeout = window.setTimeout(() => {
      ignoreNextDocumentClick = false;
      touchToggleClickTimeout = undefined;
    }, TOUCH_CLICK_GUARD_MS);

    return true;
  };

  const handleDocumentClick = () => {
    if (ignoreNextDocumentClick) {
      ignoreNextDocumentClick = false;
      return;
    }

    closeChrome();
  };

  const cleanup = () => {
    if (touchToggleClickTimeout !== undefined) {
      window.clearTimeout(touchToggleClickTimeout);
      touchToggleClickTimeout = undefined;
    }
  };

  return {
    headerVisible,
    sidePanel,
    draggingWidth,
    chromeVisible,
    sidePanelOpen,
    setDraggingWidth,
    showChrome,
    closePanel,
    togglePanel,
    closeChrome,
    onSearchOpen,
    handlePointerMove,
    handleDocumentPointerUp,
    handleDocumentClick,
    isReaderInputFocused,
    cleanup,
  };
}
