import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

const djvuBookId = '00000000-0000-0000-0000-000000000105';

async function openDjvuReader(page: Page) {
  const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
  const book = {
    ...bookMocks.items[0],
    id: djvuBookId,
    title: 'DJVU с OCR',
    format: 'djvu',
    size_bytes: file.byteLength,
  };

  await login(page);
  await page.route(`**/api/v1/books/${djvuBookId}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(book),
    });
  });
  await page.route(`**/api/v1/books/${djvuBookId}/file`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({ status: 200, contentType: 'image/vnd.djvu', body: file });
  });

  await page.goto(`/reader/${djvuBookId}`);
}

test('DJVU reader отрисовывает страницу, обнаруживает OCR и переходит между страницами', async ({
  page,
}) => {
  await openDjvuReader(page);

  const firstPage = page.locator('[data-page-number="1"]');
  const firstCanvas = firstPage.locator('canvas').first();
  await expect(firstCanvas).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => firstCanvas.evaluate((canvas) => canvas.width > 0 && canvas.height > 0))
    .toBe(true);

  await page.mouse.move(10, 10);
  await expect(page.getByRole('search').getByRole('searchbox')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => firstPage.locator('[data-testid="djvu-text-layer"] span').count())
    .toBeGreaterThan(0);
  const titleTopRatio = await firstPage.evaluate((pageElement) => {
    const title = [
      ...pageElement.querySelectorAll<HTMLElement>('[data-testid="djvu-text-layer"] span'),
    ].find((span) => span.textContent?.includes('Reliable'));
    const pageRect = pageElement.getBoundingClientRect();

    return title ? (title.getBoundingClientRect().top - pageRect.top) / pageRect.height : undefined;
  });
  expect(titleTopRatio).toBeLessThan(0.15);
  const principalTextWidth = await firstPage.evaluate((pageElement) => {
    const span = [
      ...pageElement.querySelectorAll<HTMLElement>('[data-testid="djvu-text-layer"] span'),
    ].find((element) => element.textContent?.includes('Principal'));
    if (!span) return undefined;

    const range = document.createRange();
    range.selectNodeContents(span);

    return {
      actual: range.getBoundingClientRect().width,
      expected: Number(span.dataset.textZoneWidth) * pageElement.clientWidth,
    };
  });
  expect(principalTextWidth).toBeDefined();
  expect(Math.abs(principalTextWidth!.actual - principalTextWidth!.expected)).toBeLessThan(2);

  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  const nextMatch = search.getByRole('button', { name: 'Найти следующее' });
  const previousMatch = search.getByRole('button', { name: 'Найти предыдущее' });
  const highlights = page.getByTestId('djvu-text-layer').locator('.highlight');
  const selectedHighlight = page.getByTestId('djvu-text-layer').locator('.highlight.selected');

  await searchInput.fill('Reliable');
  await expect(highlights).toHaveCount(0);
  await nextMatch.click();
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(highlights).toHaveCount(1);
  await expect(selectedHighlight).toHaveText('Reliable');

  await selectedHighlight.evaluate((element) => {
    element.dataset.searchMarker = 'persistent';
  });
  await nextMatch.click();
  await expect(selectedHighlight).toHaveAttribute('data-search-marker', 'persistent');

  await previousMatch.click();
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(selectedHighlight).toHaveText('Reliable');

  await searchInput.fill('Principal');
  await expect(selectedHighlight).toHaveText('Reliable');
  await searchInput.press('Enter');
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(selectedHighlight).toHaveText('Principal');

  const crossZoneQuery = await firstPage.getByTestId('djvu-text-layer').evaluate((layer) => {
    const zones = [...layer.children]
      .map((element) => element.textContent ?? '')
      .filter((text) => text.trim().length > 0);

    return zones.length >= 2 ? `${zones[0]} ${zones[1]}`.trim() : undefined;
  });
  expect(crossZoneQuery).toBeDefined();
  await searchInput.fill(crossZoneQuery!);
  await searchInput.press('Enter');
  await expect(selectedHighlight).toHaveCount(2);

  const pageInput = page.getByRole('spinbutton', { name: 'Номер страницы' });
  await expect(pageInput).toHaveValue('1');
  await pageInput.fill('2');
  await pageInput.press('Enter');
  await expect(pageInput).toHaveValue('2');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const secondPage = document.querySelector<HTMLElement>('[data-page-number="2"]');
        return secondPage?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      }),
    )
    .toBeLessThan(120);

  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) });
  const widthIncrease = panel.getByRole('slider', { name: 'Увеличение ширины' });
  const widthBeforeIncrease = await firstPage.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await widthIncrease.focus();
  await page.keyboard.press('ArrowRight');
  await expect(widthIncrease).toHaveValue('1');
  await expect
    .poll(() => firstPage.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(widthBeforeIncrease);

  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });
  await invert.check();
  const webglAvailable = await page.evaluate(
    () => document.createElement('canvas').getContext('webgl') !== null,
  );
  if (webglAvailable) {
    await expect(panel.getByRole('slider', { name: 'Сила' })).toBeVisible();
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }
});

test('DJVU не отрисовывает пропущенные страницы при быстром переходе', async ({ page }) => {
  await openDjvuReader(page);
  await expect(page.locator('[data-page-number="84"]')).toHaveCount(1, { timeout: 30_000 });

  await page.evaluate(async () => {
    for (const pageNumber of [10, 20, 30, 40, 50, 60, 70]) {
      const pageElement = document.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
      window.scrollTo({ top: pageElement?.offsetTop ?? 0 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });

  const targetCanvas = page.locator('[data-page-number="70"] canvas').first();
  await expect
    .poll(() => targetCanvas.evaluate((canvas) => canvas.width !== 300 || canvas.height !== 150), {
      timeout: 30_000,
    })
    .toBe(true);

  const skippedCanvas = page.locator('[data-page-number="40"] canvas').first();
  await expect
    .poll(() => skippedCanvas.evaluate((canvas) => canvas.width === 300 && canvas.height === 150))
    .toBe(true);

  await page.locator('[data-page-number="40"]').evaluate((pageElement) => {
    pageElement.scrollIntoView({ block: 'center' });
  });
  await expect
    .poll(() => skippedCanvas.evaluate((canvas) => canvas.width !== 300 || canvas.height !== 150), {
      timeout: 30_000,
    })
    .toBe(true);
});
