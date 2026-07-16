import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';

async function showReaderChrome(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
}

test('читатель PDF отрисовывает страницу в браузере', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();

  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
});

test('читатель PDF сохраняет поиск, оглавление, историю и fixed-layout настройки', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();

  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Оглавление' }).click();
  await page.getByRole('button', { name: 'Second page' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('2');

  await page.goBack();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');

  await showReaderChrome(page);
  await page.getByRole('searchbox', { name: 'Поиск по книге' }).fill('Page Two');
  await page.getByRole('searchbox', { name: 'Поиск по книге' }).press('Enter');
  await expect(page.locator('[data-testid="pdf-text-layer"] .highlight')).toHaveCount(1);

  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const overflow = page.getByRole('slider', { name: 'Увеличение ширины' });
  await overflow.fill('80');
  await expect(overflow).toHaveValue('80');
  await expect
    .poll(() =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      })),
    )
    .toEqual(expect.objectContaining({ scrollWidth: expect.any(Number), viewportWidth: 640 }));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    .toBe(true);
  await page.evaluate(() => window.scrollTo({ left: 120 }));
  await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);

  const invert = page.getByRole('checkbox', { name: 'Инверсия' });
  await invert.check();
  await expect(invert).toBeChecked();
});
