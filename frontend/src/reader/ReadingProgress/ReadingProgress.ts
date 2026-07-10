import type { ReadingProgressAdapter, ReadingProgressController } from './types';

export function createReadingProgress(adapter: ReadingProgressAdapter): ReadingProgressController {
  let restored = false;
  let userScrolled = false;

  return {
    getProgress() {
      return adapter.getProgress();
    },

    isReady() {
      return adapter.isReady();
    },

    hasRestored() {
      return restored;
    },

    markUserScrolled() {
      userScrolled = true;
    },

    reset() {
      restored = false;
      userScrolled = false;
    },

    restoreProgress(percent: number) {
      if (restored || userScrolled || !adapter.isReady()) {
        return false;
      }

      adapter.restoreProgress(percent);
      restored = true;
      return true;
    },

    onProgressChange(callback) {
      return adapter.onProgressChange?.(callback) ?? (() => undefined);
    },
  };
}
