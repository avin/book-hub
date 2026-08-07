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
  await expect(page.locator('[data-search-result-index]')).toHaveCount(1);

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

test('высокий PDF рендерится тайлами и rapid jump освобождает старые растры', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await login(page);
  await page.goto('/reader/00000000-0000-0000-0000-000000000105');

  const pageInput = page.getByRole('spinbutton', { name: 'Номер страницы' });
  await expect(page.locator('[data-page-number="1"] [data-pdf-raster-tile] canvas')).toBeVisible();

  for (const target of ['2', '3', '4', '5']) {
    await pageInput.fill(target);
    await pageInput.press('Enter');
  }

  await expect(pageInput).toHaveValue('5');
  await expect(page.locator('[data-page-number="5"] [data-pdf-raster-tile] canvas')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvases = [
          ...document.querySelectorAll<HTMLCanvasElement>('[data-pdf-raster-tile] canvas'),
        ];
        return {
          maxDimension: Math.max(...canvases.flatMap((canvas) => [canvas.width, canvas.height])),
          maxPixels: Math.max(...canvases.map((canvas) => canvas.width * canvas.height)),
          totalPixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
          renderedPages: [
            ...new Set(
              canvases
                .filter((canvas) => canvas.width > 0 && canvas.height > 0)
                .map((canvas) => Number(canvas.dataset.rasterPageNumber)),
            ),
          ],
        };
      }),
    )
    .toEqual(
      expect.objectContaining({
        maxDimension: expect.any(Number),
        maxPixels: expect.any(Number),
        totalPixels: expect.any(Number),
        renderedPages: expect.not.arrayContaining([1, 2, 3]),
      }),
    );

  const allocation = await page.evaluate(() => {
    const canvases = [
      ...document.querySelectorAll<HTMLCanvasElement>('[data-pdf-raster-tile] canvas'),
    ];
    return {
      maxDimension: Math.max(...canvases.flatMap((canvas) => [canvas.width, canvas.height])),
      maxPixels: Math.max(...canvases.map((canvas) => canvas.width * canvas.height)),
      totalPixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
    };
  });

  expect(allocation.maxDimension).toBeLessThanOrEqual(4096);
  expect(allocation.maxPixels).toBeLessThanOrEqual(4_194_304);
  expect(allocation.totalPixels).toBeLessThanOrEqual(33_554_432);

  await showReaderChrome(page);
  await page.getByRole('searchbox', { name: 'Поиск по книге' }).fill('Tall page 5');
  await page.getByRole('searchbox', { name: 'Поиск по книге' }).press('Enter');
  await expect(
    page.locator('[data-page-number="5"] [data-testid="pdf-text-layer"]').getByText('Tall page 5', {
      exact: true,
    }),
  ).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('[data-page-number="5"] [data-search-result-index]')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => [
        ...new Set(
          [...document.querySelectorAll<HTMLCanvasElement>('[data-pdf-raster-tile] canvas')]
            .filter((canvas) => canvas.width > 0 && canvas.height > 0)
            .map((canvas) => Number(canvas.dataset.rasterPageNumber)),
        ),
      ]),
    )
    .toEqual([5]);
  const rasterBeforeFilters = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-pdf-raster-tile]')].map((tile) => {
      const source = tile.querySelector('canvas')!;
      return { key: tile.dataset.tileKey, width: source.width, height: source.height };
    }),
  );

  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  await page.getByRole('checkbox', { name: 'Инверсия' }).check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-pdf-raster-tile]')].every((tile) => {
          const canvases = [...tile.querySelectorAll('canvas')];
          return (
            canvases.length === 2 &&
            canvases[0].width === canvases[1].width &&
            canvases[0].height === canvases[1].height
          );
        }),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-pdf-raster-tile]')].map((tile) => {
          const source = tile.querySelector('canvas')!;
          return { key: tile.dataset.tileKey, width: source.width, height: source.height };
        }),
      ),
    )
    .toEqual(rasterBeforeFilters);

  const invertFilterKey = await page
    .locator('[data-page-number="5"]')
    .getAttribute('data-applied-filter-key');
  await page.getByRole('checkbox', { name: 'Усиление текста' }).check();
  await expect
    .poll(() => page.locator('[data-page-number="5"]').getAttribute('data-applied-filter-key'))
    .not.toBe(invertFilterKey);

  await page.setViewportSize({ width: 760, height: 640 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLCanvasElement>('[data-pdf-raster-tile] canvas')].every(
          (canvas) =>
            canvas.width <= 4096 &&
            canvas.height <= 4096 &&
            canvas.width * canvas.height <= 4_194_304,
        ),
      ),
    )
    .toBe(true);
});
