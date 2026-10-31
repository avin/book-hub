import { readFile } from 'node:fs/promises';
import { themeIds } from '../src/styles/themes';
import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

for (const format of ['pdf', 'djvu'] as const) {
  test(`${format}: выделение мышью показывает только фон во всех темах`, async ({ page }) => {
    await login(page);

    if (format === 'djvu') {
      const bookId = '00000000-0000-0000-0000-000000000105';
      const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
      await page.route(`**/api/v1/books/${bookId}`, (route) =>
        route.fulfill({
          json: { ...bookMocks.items[0], id: bookId, format, progress_percent: 0 },
        }),
      );
      await page.route(`**/api/v1/books/${bookId}/file`, (route) =>
        route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
      );
      await page.goto(`/reader/${bookId}`);
    } else {
      await page
        .getByRole('heading', { name: 'PDF с оглавлением', exact: true })
        .getByRole('link')
        .click();
    }

    const text = page
      .getByTestId(`${format}-text-layer`)
      .first()
      .locator('span')
      .filter({ hasText: /\S/ })
      .first();
    await expect(text).toBeVisible();
    await text.scrollIntoViewIfNeeded();
    const bounds = (await text.boundingBox())!;
    await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
      .toBeTruthy();

    for (const themeId of themeIds) {
      await page.evaluate((id) => document.documentElement.setAttribute('data-theme', id), themeId);
      const selection = await text.evaluate((element) => {
        const style = getComputedStyle(element, '::selection');
        const color = document.createElement('canvas').getContext('2d')!;
        color.fillStyle = style.color;
        color.fillRect(0, 0, 1, 1);

        return {
          textAlpha: color.getImageData(0, 0, 1, 1).data[3],
          background: style.backgroundColor,
        };
      });
      expect.soft(selection.textAlpha, `${format}, ${themeId}: буквы прозрачны`).toBe(0);
      expect
        .soft(selection.background, `${format}, ${themeId}: фон виден`)
        .not.toBe('rgba(0, 0, 0, 0)');
    }
  });
}
