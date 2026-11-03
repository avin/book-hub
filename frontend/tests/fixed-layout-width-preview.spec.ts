import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

for (const format of ['pdf', 'djvu'] as const) {
  for (const filtered of [false, true]) {
    test(`${format}${filtered ? ' с фильтром' : ''}: увеличение ширины показывает черновой зум до отпускания ползунка`, async ({
      page,
    }, testInfo) => {
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

      const sourceCanvas = page.locator('[data-page-number="1"] canvas').first();
      await expect(sourceCanvas).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() =>
          sourceCanvas.evaluate((element) => {
            const page = element.closest('[data-page-number]')!;
            return (
              element.width === Math.round(page.clientWidth * Math.min(2, devicePixelRatio)) &&
              element.getContext('2d')!.getImageData(10, 10, 1, 1).data[3] === 255
            );
          }),
        )
        .toBe(true);
      await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
      await page.mouse.move(0, 0);
      await page.getByRole('button', { name: 'Внешний вид' }).click();
      if (filtered) await page.getByRole('checkbox', { name: 'Инверсия', exact: true }).check();
      const canvas = filtered
        ? page.locator('[data-page-number="1"] canvas[aria-hidden="true"]').first()
        : sourceCanvas;
      await expect(canvas).toBeVisible();
      await expect.poll(() => canvas.evaluate((element) => element.width)).toBeGreaterThan(0);
      const slider = page.getByRole('slider', { name: 'Увеличение ширины' });
      await slider.locator('..').click({ trial: true });
      const rect = (await slider.boundingBox())!;
      const before = await canvas.evaluate((element) => ({
        displayWidth: element.getBoundingClientRect().width,
        displayHeight: element.getBoundingClientRect().height,
        width: element.width,
        height: element.height,
        image: element.toDataURL(),
        pageWidthOverflows: JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}').readers
          ?.fixedLayout?.pageWidthOverflows,
      }));
      const readAnchor = () =>
        page
          .locator('[data-page-number="1"]')
          .evaluate(
            (element) =>
              -element.getBoundingClientRect().top / (element as HTMLElement).offsetHeight,
          );
      const anchor = await readAnchor();

      await page.mouse.move(rect.x + 10, rect.y + rect.height / 2);
      await page.mouse.down();
      for (const fraction of [0.3, 0.6, 0, 0.4]) {
        await page.mouse.move(rect.x + rect.width * fraction, rect.y + rect.height / 2, {
          steps: 5,
        });
        const value = Number(await slider.inputValue());
        if (value > 0) {
          await expect
            .poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width))
            .toBeGreaterThan(before.displayWidth * 1.1);
        } else {
          expect(
            await canvas.evaluate((element) => element.getBoundingClientRect().width),
          ).toBeCloseTo(before.displayWidth, 1);
        }
        const preview = await canvas.evaluate((element) => ({
          displayWidth: element.getBoundingClientRect().width,
          displayHeight: element.getBoundingClientRect().height,
          width: element.width,
          height: element.height,
          image: element.toDataURL(),
          pageWidthOverflows: JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}')
            .readers?.fixedLayout?.pageWidthOverflows,
        }));
        expect(preview.width).toBe(before.width);
        expect(preview.height).toBe(before.height);
        expect(preview.image).toBe(before.image);
        // Scroll positions and filter settings may be persisted independently of this gesture.
        expect(preview.pageWidthOverflows).toEqual(before.pageWidthOverflows);
        expect(preview.displayWidth / before.displayWidth).toBeCloseTo(
          preview.displayHeight / before.displayHeight,
          2,
        );
      }
      const committedValue = await slider.inputValue();
      if (!filtered) await page.screenshot({ path: testInfo.outputPath('width-preview.png') });
      await page.mouse.up();
      await expect
        .poll(() => canvas.evaluate((element) => element.width))
        .toBeGreaterThan(before.width);
      await expect
        .poll(() =>
          canvas.evaluate((element) =>
            Math.abs(
              element.getBoundingClientRect().width - element.width / Math.min(2, devicePixelRatio),
            ),
          ),
        )
        .toBeLessThan(1);
      await expect.poll(async () => Math.abs((await readAnchor()) - anchor)).toBeLessThan(0.003);
      if (!filtered) await page.screenshot({ path: testInfo.outputPath('width-committed.png') });

      await page.reload();
      await expect(canvas).toBeVisible({ timeout: 30_000 });
      await page.mouse.move(0, 0);
      await page.getByRole('button', { name: 'Внешний вид' }).click();
      await expect(slider).toHaveValue(committedValue);
    });
  }
}
