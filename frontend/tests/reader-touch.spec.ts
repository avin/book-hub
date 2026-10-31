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

    for (let index = 0; index < 3; index += 1) {
      await page.touchscreen.tap(195, 300);
      await expect(header).toHaveAttribute('data-visible', 'true');
      await expect(footer).toHaveAttribute('data-visible', 'true');

      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 195, y: 300 }],
      });
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 195, y: 301 }],
      });
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(header).toHaveAttribute('data-visible', 'false');
      await expect(footer).toHaveAttribute('data-visible', 'false');
    }

    await page.touchscreen.tap(350, 525);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrollAfterNext = await page.evaluate(() => window.scrollY);
    await expect(header).toHaveAttribute('data-visible', 'false');
    await expect(footer).toHaveAttribute('data-visible', 'false');

    await page.touchscreen.tap(350, 75);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollAfterNext);
    await expect(header).toHaveAttribute('data-visible', 'false');
    await expect(footer).toHaveAttribute('data-visible', 'false');
    await touchSession.detach();
  });
}
