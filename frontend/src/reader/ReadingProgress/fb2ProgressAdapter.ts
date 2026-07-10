import type { ReadingProgressAdapter } from './types';

export type Fb2ProgressLayout = {
  offsets: number[];
  heights: number[];
  totalHeight: number;
};

export type Fb2ProgressAdapterState = {
  getLayout: () => Fb2ProgressLayout;
  getDocumentScrollTop: () => number;
  getViewportHeight: () => number;
  isReady: () => boolean;
  scrollToDocumentTop: (documentScrollTop: number) => void;
  onScroll?: (callback: () => void) => () => void;
};

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function createFb2ProgressAdapter(state: Fb2ProgressAdapterState): ReadingProgressAdapter {
  const maxDocumentScroll = () => {
    const layout = state.getLayout();
    return Math.max(0, layout.totalHeight - state.getViewportHeight());
  };

  return {
    isReady: () => state.isReady(),

    getProgress() {
      const maxScroll = maxDocumentScroll();

      if (maxScroll === 0) {
        return 0;
      }

      return clampPercent((state.getDocumentScrollTop() / maxScroll) * 100);
    },

    restoreProgress(percent: number) {
      const maxScroll = maxDocumentScroll();
      state.scrollToDocumentTop((maxScroll * clampPercent(percent)) / 100);
    },

    onProgressChange(callback) {
      return state.onScroll?.(callback) ?? (() => undefined);
    },
  };
}
