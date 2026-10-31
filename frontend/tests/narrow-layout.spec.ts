import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

const widths = [390, 719, 720, 900, 390];

test('библиотека экономит боковые отступы только при ширине меньше 720 px', async ({ page }) => {
  await login(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    const padding = width < 720 ? '16px' : '24px';
    await expect(page.locator('main')).toHaveCSS('padding-left', padding);
    await expect(page.locator('main')).toHaveCSS('padding-right', padding);
    await expect(page.getByRole('article').first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});

const readerBooks = [
  books.items[0],
  books.items[2],
  books.items[3],
  { ...books.items[0], id: '00000000-0000-0000-0000-000000000105', format: 'djvu' },
];

for (const book of readerBooks) {
  test(`отступы и ширина области чтения при изменении окна: ${book.format}`, async ({
    page,
    api,
  }) => {
    if (book.format === 'djvu') {
      await api.intercept({ method: 'GET', path: `/v1/books/${book.id}` }, book);
      const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
      await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
        route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
      );
    }

    await login(page);
    await page.goto(`/reader/${book.id}`);
    const fixedLayout = book.format === 'pdf' || book.format === 'djvu';
    const content = page.locator(fixedLayout ? '[data-page-number="1"]' : 'main article');
    await expect(content).toBeVisible();

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      const padding = fixedLayout ? (width < 720 ? 16 : width === 720 ? 10 : 20) : 8;
      await expect(page.locator('main')).toHaveCSS('padding-left', `${padding}px`);
      await expect(page.locator('main')).toHaveCSS('padding-right', `${padding}px`);

      if (fixedLayout || width < 720) {
        await expect
          .poll(() =>
            content.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return Math.round(
                Math.max(rect.left, document.documentElement.clientWidth - rect.right),
              );
            }),
          )
          .toBe(padding);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  });
}
