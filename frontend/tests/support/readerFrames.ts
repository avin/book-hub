import { expect, type Page } from '@playwright/test';

export async function expectStableReaderBlocks(
  page: Page,
  blocks: { text: string; top: number }[],
  update: () => Promise<unknown>,
) {
  await page.evaluate((blocks) => {
    const frames: (number | null)[][] = [];
    const recording = new Promise<typeof frames>((resolve) => {
      const sample = () => {
        requestAnimationFrame(() => {
          // Read after animation callbacks, when scroll corrections for this paint ran.
          setTimeout(() => {
            const slots = [...document.querySelectorAll('article > div')];
            frames.push(
              blocks.map(
                ({ text }) =>
                  slots.find((slot) => slot.textContent === text)?.getBoundingClientRect().top ??
                  null,
              ),
            );
            if (frames.length < 20) sample();
            else resolve(frames);
          }, 0);
        });
      };
      sample();
    });
    Reflect.set(window, 'readerFrameRecording', recording);
  }, blocks);
  await update();
  const frames: (number | null)[][] = await page.evaluate(() =>
    Reflect.get(window, 'readerFrameRecording'),
  );
  for (const frame of frames) {
    for (const [index, block] of blocks.entries()) {
      expect(frame[index], JSON.stringify(frames)).not.toBeNull();
      expect(frame[index], JSON.stringify(frames)).toBeCloseTo(block.top, 0);
    }
  }
}
