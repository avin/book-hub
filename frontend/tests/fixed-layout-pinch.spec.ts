import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

for (const format of ['pdf', 'djvu'] as const) {
  test(`${format}: жест двумя пальцами меняет ширину и сохраняет её`, async ({ page, api }) => {
    await login(page);
    let id: string;
    if (format === 'djvu') {
      id = '00000000-0000-0000-0000-000000000105';
      await api.intercept(
        { method: 'GET', path: `/v1/books/${id}` },
        { ...books.items[0], id, format },
      );
      const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
      await page.route(`**/api/v1/books/${id}/file`, (route) =>
        route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
      );
      await page.goto(`/reader/${id}`);
    } else {
      await page
        .getByRole('heading', { name: 'PDF с оглавлением', exact: true })
        .getByRole('link')
        .click();
      id = new URL(page.url()).pathname.split('/').at(-1)!;
    }
    const sheet = page.locator('[data-page-number="1"]');
    await expect(sheet.locator('canvas').first()).toBeVisible();
    await page.touchscreen.tap(195, 400);
    const header = page.getByTestId('reader-floating-header');
    const footer = page.getByTestId('reader-floating-footer');
    await expect(header).toHaveAttribute('data-visible', 'true');
    const initialWidth = (await sheet.boundingBox())!.width;
    const client = await page.context().newCDPSession(page);
    const points = (left: number, right: number) => [
      { x: left, y: 400, id: 1 },
      { x: right, y: 400, id: 2 },
    ];
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(145, 245),
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(115, 275),
    });
    await expect
      .poll(async () => (await sheet.boundingBox())!.width)
      .toBeGreaterThan(initialWidth * 1.3);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    expect(
      await page.evaluate(
        (bookId) =>
          JSON.parse(localStorage.getItem('book-hub-preferences')!).readers?.fixedLayout
            ?.pageWidthOverflows?.[bookId],
        id,
      ),
    ).toBeUndefined();
    for (const bar of [header, footer]) {
      const bounds = (await bar.boundingBox())!;
      expect(bounds.x).toBe(0);
      expect(bounds.width).toBe(390);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const storedValue = () =>
      page.evaluate(
        (bookId) =>
          JSON.parse(localStorage.getItem('book-hub-preferences')!).readers?.fixedLayout
            ?.pageWidthOverflows?.[bookId],
        id,
      );
    await expect.poll(storedValue).toBeGreaterThan(0);
    const value = await storedValue();
    expect(value).toBeLessThanOrEqual(80);
    await page.reload();
    await expect(sheet.locator('canvas').first()).toBeVisible();
    await page.touchscreen.tap(195, 400);
    await page.getByRole('button', { name: 'Внешний вид' }).tap();
    await expect(page.getByRole('slider', { name: 'Увеличение ширины' })).toHaveValue(
      String(value),
    );
    await page
      .locator('aside')
      .filter({ hasText: 'Внешний вид' })
      .getByRole('button', { name: 'Закрыть', exact: true })
      .tap();
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(100, 290),
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(180, 210),
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(storedValue).toBe(0);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(145, 245),
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(30, 360),
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(storedValue).toBe(80);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(100, 290),
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(160, 230),
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(storedValue).toBe(80);
    await expect
      .poll(() => page.locator('main').evaluate((element) => element.style.transform))
      .toBe('');
    await client.detach();
  });
}
