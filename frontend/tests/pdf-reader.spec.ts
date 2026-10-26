import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';

async function showReaderChrome(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
}

test('перемещение первого PDF-фильтра в конец не ломает читалку', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page
    .getByRole('heading', { name: 'PDF с оглавлением', exact: true })
    .getByRole('link')
    .click();
  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Внешний вид' }).click();

  const items = page.locator('[data-filter-id]');
  const initialOrder = await items.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-filter-id')),
  );
  const handle = page.getByTestId(`pdf-filter-drag-handle-${initialOrder[0]}`);
  await handle.click({ trial: true });
  const start = (await handle.boundingBox())!;
  const end = (await items.last().boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 10, { steps: 5 });
  await expect(items).toHaveCount(initialOrder.length + 1);
  await page.mouse.move(start.x + start.width / 2, end.y + end.height - 2, { steps: 30 });
  await page.mouse.up();

  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(errors).toEqual([]);
  await expect(items).toHaveCount(initialOrder.length);
  await expect(items.last()).toHaveAttribute('data-filter-id', initialOrder[0]!);
  const movedOrder = [...initialOrder.slice(1), initialOrder[0]];
  const readOrder = () =>
    items.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-filter-id')),
    );
  await expect.poll(readOrder).toEqual(movedOrder);

  await page.reload();
  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  await expect.poll(readOrder).toEqual(movedOrder);

  const grayscale = page.getByRole('checkbox', { name: 'Оттенки серого', exact: true });
  await grayscale.check();
  const grayscaleHandle = page.getByTestId('pdf-filter-drag-handle-grayscale');
  await grayscaleHandle.click({ trial: true });
  const grayscaleStart = (await grayscaleHandle.boundingBox())!;
  const first = (await items.first().boundingBox())!;
  await page.mouse.move(
    grayscaleStart.x + grayscaleStart.width / 2,
    grayscaleStart.y + grayscaleStart.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(grayscaleStart.x + grayscaleStart.width / 2, grayscaleStart.y - 10, {
    steps: 5,
  });
  await expect(items).toHaveCount(initialOrder.length + 1);
  await page.mouse.move(first.x + 32, first.y + 2, { steps: 30 });
  await page.mouse.up();
  await expect
    .poll(readOrder)
    .toEqual(['grayscale', ...movedOrder.filter((id) => id !== 'grayscale')]);
  await expect(grayscale).toBeChecked();
  expect(errors).toEqual([]);
});

test('читатель PDF отрисовывает страницу в браузере', async ({ page }) => {
  await login(page);
  await page
    .getByRole('heading', { name: 'Мастер и Маргарита', exact: true })
    .getByRole('link')
    .click();

  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
});

for (const deviceScaleFactor of [1, 1.25, 2]) {
  test.describe(`PDF при плотности экрана ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test('не растягивает готовые canvas при изменении ширины и включении фильтра', async ({
      page,
    }) => {
      await login(page);
      await page
        .getByRole('heading', { name: 'PDF с оглавлением', exact: true })
        .getByRole('link')
        .click();
      const canvases = page.locator('[data-page-number="1"] canvas');

      const expectNativeCanvasSize = async () => {
        await expect
          .poll(() =>
            canvases.evaluateAll((elements) => {
              const visible = elements.filter(
                (canvas) => getComputedStyle(canvas).display !== 'none',
              );
              const ratio = Math.min(2, window.devicePixelRatio);

              return (
                visible.length > 0 &&
                visible.every((element) => {
                  const canvas = element as HTMLCanvasElement;
                  const rect = canvas.getBoundingClientRect();
                  const page = canvas.closest('[data-page-number]')!;

                  return (
                    canvas.width === Math.round(page.clientWidth * ratio) &&
                    canvas.height > 0 &&
                    Math.abs(rect.width - canvas.width / ratio) < 0.02 &&
                    Math.abs(rect.height - canvas.height / ratio) < 0.02
                  );
                })
              );
            }),
          )
          .toBe(true);
      };

      for (const width of [1100, 1101]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNativeCanvasSize();
      }

      await showReaderChrome(page);
      await page.getByRole('button', { name: 'Внешний вид' }).click();
      await page.getByRole('slider', { name: 'Увеличение ширины' }).fill('80');
      await expect.poll(() => canvases.count()).toBeGreaterThan(1);
      await expectNativeCanvasSize();
      await page.getByRole('checkbox', { name: 'Инверсия', exact: true }).check();
      await expect.poll(() => canvases.count()).toBeGreaterThan(2);
      await expectNativeCanvasSize();
    });
  });
}

test('читатель PDF сохраняет поиск, оглавление, историю и fixed-layout настройки', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await login(page);
  await page
    .getByRole('heading', { name: 'PDF с оглавлением', exact: true })
    .getByRole('link')
    .click();
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
