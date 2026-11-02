import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

async function openReader(page: Page, format: 'pdf' | 'djvu') {
  await page.setViewportSize({ width: 1000, height: 900 });
  await login(page);
  if (format === 'djvu') {
    const id = '00000000-0000-0000-0000-000000000105';
    const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
    await page.route(`**/api/v1/books/${id}`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ...bookMocks.items[0], id, format }),
      }),
    );
    await page.route(`**/api/v1/books/${id}/file`, (route) =>
      route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
    );
    await page.goto(`/reader/${id}`);
  } else {
    await page
      .getByRole('heading', { name: 'PDF с оглавлением', exact: true })
      .getByRole('link')
      .click();
  }
  await expectRendered(page.locator('[data-page-number="1"] canvas').first());
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
}

async function expectRendered(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => {
        const page = element.closest('[data-page-number]')!;
        return (
          element.width === Math.round(page.clientWidth * Math.min(2, devicePixelRatio)) &&
          element.getContext('2d')!.getImageData(10, 10, 1, 1).data[3] === 255
        );
      }),
    )
    .toBe(true);
}

for (const format of ['pdf', 'djvu'] as const) {
  for (const adjustment of ['none', 'zoom', 'unchanged'] as const) {
    test(`${format}: инверсия меняет видимые пиксели после ${adjustment}`, async ({
      page,
    }, testInfo) => {
      await openReader(page, format);
      const source = page.locator('[data-page-number="1"] canvas').first();
      const slider = page.getByRole('slider', { name: 'Увеличение ширины' });
      await slider.locator('..').click({ trial: true });
      if (adjustment === 'zoom') await slider.fill('30');
      if (adjustment === 'unchanged') {
        const rect = (await slider.boundingBox())!;
        await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 5 });
        await page.mouse.move(rect.x + 1, rect.y + rect.height / 2, { steps: 5 });
        await page.mouse.up();
        await expect(slider).toHaveValue('0');
      }
      await expectRendered(source);
      const original = await source.evaluate((element) => [
        ...element.getContext('2d')!.getImageData(10, 10, 1, 1).data,
      ]);
      const clip = { x: 50, y: 200, width: 300, height: 300 };
      const before = await page.screenshot({ clip });
      const sourceRect = (await source.boundingBox())!;
      await page.getByRole('checkbox', { name: 'Инверсия', exact: true }).check();
      const filtered = page.locator('[data-page-number="1"] canvas[aria-hidden="true"]').first();
      await expect(filtered).toBeVisible();
      await expect
        .poll(() =>
          filtered.evaluate((element) => [
            ...element.getContext('2d')!.getImageData(10, 10, 1, 1).data,
          ]),
        )
        .toEqual(original.map((value, index) => (index === 3 ? value : 255 - value)));
      expect((await page.screenshot({ clip })).equals(before)).toBe(false);
      const filteredRect = (await filtered.boundingBox())!;
      expect(filteredRect.x).toBeCloseTo(sourceRect.x, 1);
      expect(filteredRect.y).toBeCloseTo(sourceRect.y, 1);
      if (format === 'djvu' && adjustment === 'none') {
        await page.screenshot({ path: testInfo.outputPath('inversion-visible.png') });
      }

      await page.getByRole('slider', { name: 'Сила', exact: true }).fill('0');
      await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(true);
      await page.getByRole('slider', { name: 'Сила', exact: true }).fill('1');
      await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(false);
      await page.getByRole('checkbox', { name: 'Инверсия', exact: true }).uncheck();
      await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(true);
    });
  }
}

test('DJVU: каждый фильтр меняет видимую страницу, выключение возвращает оригинал', async ({
  page,
}) => {
  await openReader(page, 'djvu');
  const clip = { x: 50, y: 100, width: 400, height: 650 };
  const before = await page.screenshot({ clip });
  for (const name of [
    'Усиление текста',
    'Мягкое утолщение текста',
    'Яркость, контраст и гамма',
    'Тёплый фильтр',
    'Оттенки серого',
  ]) {
    await test.step(name, async () => {
      const checkbox = page.getByRole('checkbox', { name, exact: true });
      await checkbox.check();
      if (name === 'Яркость, контраст и гамма') {
        await page.getByRole('slider', { name: 'Яркость', exact: true }).fill('-0.3');
      }
      await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(false);
      await checkbox.uncheck();
      await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(true);
    });
  }
});
