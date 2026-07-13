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

test('DJVU перерисовывает страницы после завершения перетаскивания ширины', async ({ page }) => {
  await openDjvuReader(page);

  const firstCanvas = page.locator('[data-page-number="1"] canvas').first();
  const secondCanvas = page.locator('[data-page-number="2"] canvas').first();
  await expect(firstCanvas).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => firstCanvas.evaluate((canvas) => canvas.width > 300)).toBe(true);
  await expect.poll(() => secondCanvas.evaluate((canvas) => canvas.width > 300)).toBe(true);

  await page.mouse.move(10, 10);
  await page.waitForTimeout(400);
  const ruler = page.getByRole('slider', { name: 'Ширина страницы' });
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();
  if (!rulerBox) return;

  await page.evaluate(() => {
    const canvasStyleWrites: number[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if ((mutation.target as HTMLElement).matches('canvas')) {
          canvasStyleWrites.push(performance.now());
        }
      }
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
    (window as Window & { djvuCanvasStyleWrites?: number[] }).djvuCanvasStyleWrites =
      canvasStyleWrites;
  });

  const rulerY = rulerBox.y + rulerBox.height / 2;
  const rulerCenterX = rulerBox.x + rulerBox.width / 2;
  await page.mouse.move(rulerCenterX + 400, rulerY);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(rulerCenterX + 400 - step * 10, rulerY);
  }
  await page.waitForTimeout(200);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { djvuCanvasStyleWrites?: number[] }).djvuCanvasStyleWrites?.length,
      ),
    )
    .toBe(0);

  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as Window & { djvuCanvasStyleWrites?: number[] }).djvuCanvasStyleWrites
              ?.length ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { djvuCanvasStyleWrites?: number[] }).djvuCanvasStyleWrites?.length ??
        0,
    ),
  ).toBeLessThanOrEqual(4);
  await expect(ruler).toHaveAttribute('aria-valuenow', '700');
});

test('DJVU сохраняет положение и масштабирует готовый canvas при изменении viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await openDjvuReader(page);

  const targetPage = page.locator('[data-page-number="20"]');
  await expect(targetPage).toHaveCount(1, { timeout: 30_000 });
  await targetPage.evaluate((element) => {
    window.scrollTo({ top: element.offsetTop + element.clientHeight * 0.8 });
  });
  await expect
    .poll(() =>
      targetPage.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return -rect.top / rect.height;
      }),
    )
    .toBeCloseTo(0.8, 2);

  const canvas = targetPage.locator('canvas').first();
  await expect.poll(() => canvas.evaluate((element) => element.width > 300)).toBe(true);
  const canvasWidth = await canvas.evaluate((element) => element.width);
  const widthRatioBeforeResize = await targetPage.evaluate((element) => {
    const reader = element.parentElement?.parentElement;
    return reader ? element.getBoundingClientRect().width / reader.clientWidth : 0;
  });

  await page.setViewportSize({ width: 1_000, height: 720 });
  await expect
    .poll(() =>
      targetPage.evaluate((element) => {
        const reader = element.parentElement?.parentElement;
        return reader ? element.getBoundingClientRect().width / reader.clientWidth : 0;
      }),
    )
    .toBeGreaterThan(widthRatioBeforeResize);
  await expect
    .poll(() =>
      targetPage.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return -rect.top / rect.height;
      }),
    )
    .toBeCloseTo(0.8, 2);
  await expect(canvas).toHaveJSProperty('width', canvasWidth);
});

test('DJVU сохраняет положение внутри страницы при изменении увеличения ширины', async ({
  page,
}) => {
  await openDjvuReader(page);

  const targetPage = page.locator('[data-page-number="20"]');
  await expect(targetPage).toHaveCount(1, { timeout: 30_000 });
  await targetPage.evaluate((element) => {
    window.scrollTo({ top: element.offsetTop + element.clientHeight * 0.8 });
  });
  await expect
    .poll(() =>
      targetPage.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return -rect.top / rect.height;
      }),
    )
    .toBeCloseTo(0.8, 2);

  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) });
  const widthIncrease = panel.getByRole('slider', { name: 'Увеличение ширины' });

  await widthIncrease.focus();
  await page.keyboard.press('ArrowRight', { delay: 5 });
  await page.keyboard.press('PageUp');
  await expect(widthIncrease).toHaveValue('9');
  await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 200)));
  await expect
    .poll(() =>
      targetPage.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return -rect.top / rect.height;
      }),
    )
    .toBeCloseTo(0.8, 2);
});
