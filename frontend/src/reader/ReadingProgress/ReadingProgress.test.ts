import { describe, expect, it } from 'vitest';
import { createReadingProgress } from './ReadingProgress';
import type { ReadingProgressAdapter } from './types';

function createTestAdapter(
  overrides: Partial<ReadingProgressAdapter> = {},
): ReadingProgressAdapter {
  let scrollTop = 0;

  return {
    isReady: () => true,
    getProgress: () => scrollTop,
    restoreProgress: (percent) => {
      scrollTop = percent;
    },
    onProgressChange: () => () => undefined,
    ...overrides,
  };
}

describe('createReadingProgress', () => {
  it('restores only once when ready', () => {
    let restoreCount = 0;
    let scrollTop = 0;
    const progress = createReadingProgress(
      createTestAdapter({
        getProgress: () => scrollTop,
        restoreProgress: (percent) => {
          restoreCount += 1;
          scrollTop = percent;
        },
      }),
    );

    expect(progress.restoreProgress(42)).toBe(true);
    expect(progress.restoreProgress(42)).toBe(false);
    expect(restoreCount).toBe(1);
  });

  it('skips restore after the user scrolled', () => {
    let restoreCount = 0;
    const progress = createReadingProgress(
      createTestAdapter({
        restoreProgress: () => {
          restoreCount += 1;
        },
      }),
    );

    progress.markUserScrolled();
    expect(progress.restoreProgress(42)).toBe(false);
    expect(restoreCount).toBe(0);
  });

  it('resets restore state on book change', () => {
    let restoreCount = 0;
    let scrollTop = 0;
    const progress = createReadingProgress(
      createTestAdapter({
        getProgress: () => scrollTop,
        restoreProgress: (percent) => {
          restoreCount += 1;
          scrollTop = percent;
        },
      }),
    );

    expect(progress.restoreProgress(10)).toBe(true);
    progress.reset();
    expect(progress.restoreProgress(20)).toBe(true);
    expect(restoreCount).toBe(2);
  });
});
