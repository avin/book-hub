import { expect, test } from './fixtures';
import { login } from './support/api';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
test('перетаскивание полосы прокрутки сохраняет положение бегунка под мышью', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.addStyleTag({
    content:
      'html::-webkit-scrollbar { width: 16px !important; } html::-webkit-scrollbar-thumb { background: gray; min-height: 17px; } html::-webkit-scrollbar-button { display: none; }',
  });
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
  const geometry = await page.evaluate(() => ({
    width: innerWidth - document.documentElement.clientWidth,
    height: innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(geometry.width).toBeGreaterThan(0);
  await page.evaluate(() => {
    const heights: number[] = [];
    const observer = new ResizeObserver(() => heights.push(document.documentElement.scrollHeight));
    observer.observe(document.querySelector('article')!);
    Reflect.set(window, 'finishScrollbarRecording', () => {
      observer.disconnect();
      return heights;
    });
  });
  const thumbHeight = Math.max(17, geometry.height ** 2 / geometry.scrollHeight);
  const grabOffset = Math.floor(thumbHeight / 2);
  await page.mouse.move(1280 - geometry.width / 2, grabOffset);
  await page.mouse.down();
  try {
    for (const y of [150, 300, 450, 600, 450, 300, 150]) {
      await page.mouse.move(1280 - geometry.width / 2, y, { steps: 8 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const current = await page.evaluate(() => ({
        y: scrollY,
        height: document.documentElement.scrollHeight,
      }));
      expect(current.height).toBe(geometry.scrollHeight);
      const expected =
        ((geometry.scrollHeight - geometry.height) * (y - grabOffset)) /
        (geometry.height - thumbHeight);
      expect(current.y).toBeCloseTo(expected, -2);
    }
  } finally {
    await page.mouse.up();
  }
  const heights: number[] = await page.evaluate(() =>
    Reflect.get(window, 'finishScrollbarRecording')(),
  );
  expect([...new Set(heights)]).toEqual([geometry.scrollHeight]);
});
