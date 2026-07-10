import { describe, expect, it } from 'vitest';
import { createFb2ProgressAdapter } from './fb2ProgressAdapter';

describe('createFb2ProgressAdapter', () => {
  it('returns 0 at the start and 100 at the end of the document', () => {
    let documentScrollTop = 0;
    const adapter = createFb2ProgressAdapter({
      getLayout: () => ({
        offsets: [0, 100, 250],
        heights: [100, 150, 200],
        totalHeight: 450,
      }),
      getDocumentScrollTop: () => documentScrollTop,
      getViewportHeight: () => 100,
      isReady: () => true,
      scrollToDocumentTop: (nextTop) => {
        documentScrollTop = nextTop;
      },
    });

    expect(adapter.getProgress()).toBe(0);

    documentScrollTop = 350;
    expect(adapter.getProgress()).toBe(100);
  });

  it('round-trips restoreProgress through getProgress', () => {
    let documentScrollTop = 0;
    const adapter = createFb2ProgressAdapter({
      getLayout: () => ({
        offsets: [0, 200, 500],
        heights: [200, 300, 400],
        totalHeight: 900,
      }),
      getDocumentScrollTop: () => documentScrollTop,
      getViewportHeight: () => 200,
      isReady: () => true,
      scrollToDocumentTop: (nextTop) => {
        documentScrollTop = nextTop;
      },
    });

    adapter.restoreProgress(50);
    expect(adapter.getProgress()).toBe(50);
  });

  it('increases monotonically when scrolling forward', () => {
    let documentScrollTop = 0;
    const adapter = createFb2ProgressAdapter({
      getLayout: () => ({
        offsets: [0, 120, 300],
        heights: [120, 180, 220],
        totalHeight: 520,
      }),
      getDocumentScrollTop: () => documentScrollTop,
      getViewportHeight: () => 120,
      isReady: () => true,
      scrollToDocumentTop: (nextTop) => {
        documentScrollTop = nextTop;
      },
    });

    const samples = [0, 80, 160, 240, 320, 400].map((top) => {
      documentScrollTop = top;
      return adapter.getProgress();
    });

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]);
    }
  });
});
