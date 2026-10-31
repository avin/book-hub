import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

test.use({ viewport: { width: 390, height: 600 }, hasTouch: true, isMobile: true });

const readerBooks = [
  books.items[0],
  books.items[2],
  books.items[3],
  { ...books.items[0], id: '00000000-0000-0000-0000-000000000105', format: 'djvu' },
];

for (const book of readerBooks) {
  test(`сенсорные панели и перелистывание: ${book.format}`, async ({ page, api }) => {
    if (book.format === 'djvu') {
      await api.intercept({ method: 'GET', path: `/v1/books/${book.id}` }, book);
      const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
      await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
        route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
      );
    }

    await login(page);
    await page.goto(`/reader/${book.id}`);
    await expect(page.locator('main')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(600);
    const header = page.getByTestId('reader-floating-header');
    const footer = page.getByTestId('reader-floating-footer');
    const touchSession = await page.context().newCDPSession(page);
    const isFullscreen = () =>
      page.evaluate(() => document.fullscreenElement === document.documentElement);
    const tapAt = async (x: number, y: number) => {
      const point = await page.evaluate(
        ({ x, y }) => ({ x: window.innerWidth * x, y: window.innerHeight * y }),
        { x, y },
      );
      await page.touchscreen.tap(point.x, point.y);
    };

    for (let index = 0; index < 3; index += 1) {
      await tapAt(0.5, 0.5);
      await expect(header).toHaveAttribute('data-visible', 'true');
      await expect(footer).toHaveAttribute('data-visible', 'true');
      await expect.poll(isFullscreen).toBe(false);
      const center = await page.evaluate(() => ({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }));

      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [center],
      });
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...center, y: center.y + 1 }],
      });
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(header).toHaveAttribute('data-visible', 'false');
      await expect(footer).toHaveAttribute('data-visible', 'false');
      await expect.poll(isFullscreen).toBe(true);
    }

    await tapAt(0.9, 0.875);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrollAfterNext = await page.evaluate(() => window.scrollY);
    await expect(header).toHaveAttribute('data-visible', 'false');
    await expect(footer).toHaveAttribute('data-visible', 'false');

    await tapAt(0.9, 0.125);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollAfterNext);
    await expect(header).toHaveAttribute('data-visible', 'false');
    await expect(footer).toHaveAttribute('data-visible', 'false');
    await expect.poll(isFullscreen).toBe(true);

    await page.evaluate(() => document.exitFullscreen());
    await expect(header).toHaveAttribute('data-visible', 'true');
    await expect(footer).toHaveAttribute('data-visible', 'true');
    await expect.poll(isFullscreen).toBe(false);
    await touchSession.detach();
  });
}

test('тап по книге открывает её в fullscreen с закрытыми панелями', async ({ page }) => {
  await login(page);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').tap();
  await expect(page.locator('main')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement))
    .toBe(true);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'false');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');
});
