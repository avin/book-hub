export const CHROME_SHOW_EDGE_PX = 88;
export const CHROME_HIDE_MIDDLE_PX = 164;
export const TOUCH_TOGGLE_TOP_FRACTION = 0.25;
export const TOUCH_TOGGLE_BOTTOM_FRACTION = 0.75;
export const TOUCH_CLICK_GUARD_MS = 500;

export type ReaderSidePanel = 'none' | 'settings' | 'toc';

export interface ReaderSessionOptions {
  onChromeClose?: () => void;
  onTouchToggle?: () => void;
}

export interface ReaderSession {
  headerVisible: () => boolean;
  sidePanel: () => ReaderSidePanel;
  draggingWidth: () => boolean;
  chromeVisible: () => boolean;
  sidePanelOpen: () => boolean;
  setDraggingWidth: (value: boolean) => void;
  showChrome: () => void;
  closePanel: () => void;
  togglePanel: (panel: Exclude<ReaderSidePanel, 'none'>) => void;
  closeChrome: () => void;
  onSearchOpen: () => void;
  handlePointerMove: (event: PointerEvent) => void;
  handleDocumentPointerUp: (event: PointerEvent) => boolean;
  handleDocumentClick: () => void;
  isReaderInputFocused: () => boolean;
  cleanup: () => void;
}
