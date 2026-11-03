import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

for (const format of ['fb2', 'pdf']) {
  test(`${format}: кнопки внешнего вида доступны после прокрутки настроек`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 682 });
    await login(page);
    const book = books.items.find((book) => book.format === format)!;
    await page.goto(`/reader/${book.id}`);
    if (format === 'pdf') {
      await expect(page.locator('[data-page-number="1"] canvas').first()).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
    }
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Внешний вид', exact: true }).click();
    const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
    await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    const reset = panel.getByRole('button', { name: 'Сбросить', exact: true });
    const autoWidth = panel.getByRole('button', { name: 'Автоширина', exact: true });
    const close = panel.getByRole('button', { name: 'Закрыть', exact: true });
    await expect(reset).not.toBeInViewport();
    await expect(autoWidth).not.toBeInViewport();
    const bookScroll = await page.evaluate(() => window.scrollY);

    await autoWidth.scrollIntoViewIfNeeded();
    await expect(reset).toBeInViewport({ ratio: 1 });
    await expect(autoWidth).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(bookScroll);

    await panel.hover();
    await page.mouse.wheel(0, -2000);
    await expect(reset).not.toBeInViewport();
    await expect(close).toBeInViewport({ ratio: 1 });
  });
}
