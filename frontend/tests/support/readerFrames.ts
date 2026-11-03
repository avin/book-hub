import { expect, type Page } from '@playwright/test';

export async function expectStableReaderBlocks(
  page: Page,
  blocks: { text: string; top: number }[],
  update: () => Promise<unknown>,
) {
  await page.evaluate((blocks) => {
    const frames: (number | null)[][] = [];
    let remainingFrames: number | undefined;
    const marker = document.createElement('div');
    marker.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
    document.body.append(marker);
    let frame: number;
    const recording = new Promise<typeof frames>((resolve) => {
      // ResizeObserver runs after animation callbacks and layout, before the frame is painted.
      // A timer can observe changes made after the last paint but corrected before the next one.
      const observer = new ResizeObserver(() => {
        const slots = [...document.querySelectorAll('article > div')];
        frames.push(
          blocks.map(
            ({ text }) =>
              slots.find((slot) => slot.textContent === text)?.getBoundingClientRect().top ?? null,
          ),
        );
        if (remainingFrames !== undefined && --remainingFrames === 0) {
          observer.disconnect();
          cancelAnimationFrame(frame);
          marker.remove();
          resolve(frames);
        }
      });
      observer.observe(marker);
      const tick = () => {
        marker.style.width = marker.style.width === '1px' ? '2px' : '1px';
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    Reflect.set(window, 'finishReaderFrameRecording', () => {
      // Keep recording throughout the action, even if Playwright dispatches it slowly.
      remainingFrames = 20;
      return recording;
    });
  }, blocks);
  await update();
  const frames: (number | null)[][] = await page.evaluate(() =>
    Reflect.get(window, 'finishReaderFrameRecording')(),
  );
  for (const frame of frames) {
    for (const [index, block] of blocks.entries()) {
      expect(frame[index], JSON.stringify(frames)).not.toBeNull();
      expect(frame[index], JSON.stringify(frames)).toBeCloseTo(block.top, 0);
    }
  }
}
