import { readFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

test.use({ viewport: { width: 390, height: 600 }, hasTouch: true, isMobile: true });

async function scrollPosition(slider: Locator, reset = false) {
  return slider.evaluate((element, reset) => {
    let parent = element.parentElement;
    while (parent && getComputedStyle(parent).overflowY !== 'auto') {
      parent = parent.parentElement;
    }
    if (reset && parent) parent.scrollTop = 0;
    return parent?.scrollTop ?? 0;
  }, reset);
}

const readerBooks = [
  { ...books.items[0], id: '00000000-0000-0000-0000-000000000105', format: 'djvu' },
];

for (const book of readerBooks) {
  test(`свайпы по настройкам: ${book.format}`, async ({ page, api }) => {
    if (book.format === 'djvu') {
      await api.intercept({ method: 'GET', path: `/v1/books/${book.id}` }, book);
      const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
      await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
        route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
      );
    }
    await login(page);
    await page.goto(`/reader/${book.id}`);
    await expect(page.locator('main')).toBeVisible();
    await page.touchscreen.tap(195, 300);
    await page.getByRole('button', { name: 'Внешний вид', exact: true }).tap();
    const slider = page
      .locator('aside')
      .filter({ hasText: 'Внешний вид' })
      .locator('input[type="range"]')
      .first();
    await slider.locator('..').click({ trial: true });
    const bounds = (await slider.boundingBox())!;
    const initial = await slider.inputValue();
    const session = await page.context().newCDPSession(page);
    const thumbRatio = await slider.evaluate(
      (element: HTMLInputElement) =>
        (element.valueAsNumber - Number(element.min)) / (Number(element.max) - Number(element.min)),
    );
    for (const ratio of [0.8, thumbRatio]) {
      await scrollPosition(slider, true);
      const point = {
        x: bounds.x + 8 + (bounds.width - 16) * ratio,
        y: bounds.y + bounds.height / 2,
      };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await expect(slider).toHaveValue(initial);
      for (let step = 1; step <= 8; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: point.x, y: point.y - step * 12 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(slider).toHaveValue(initial);
      await expect.poll(() => scrollPosition(slider)).toBeGreaterThan(20);
    }

    await scrollPosition(slider, true);
    await slider.locator('..').click({ trial: true });
    const horizontalBounds = (await slider.boundingBox())!;
    const point = {
      x: horizontalBounds.x + horizontalBounds.width * 0.5,
      y: horizontalBounds.y + horizontalBounds.height / 2,
    };
    await page.touchscreen.tap(point.x, point.y);
    await expect(slider).toHaveValue(initial);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 3, y: point.y + 2 }],
    });
    await expect(slider).toHaveValue(initial);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 50, y: point.y + 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const changed = Number(await slider.inputValue());
    expect(changed).toBeGreaterThan(Number(initial));
    const range = await slider.evaluate(
      (element: HTMLInputElement) => Number(element.max) - Number(element.min),
    );
    expect(changed - Number(initial)).toBeLessThan(range * 0.3);
    await expect.poll(() => scrollPosition(slider)).toBe(0);

    // A mouse still jumps to the clicked position, even on a touch-capable device.
    await page.mouse.click(bounds.x + bounds.width * 0.75, point.y);
    const mouseValue = Number(await slider.inputValue());
    expect(mouseValue).toBeGreaterThan(changed);
    await page.mouse.move(bounds.x + bounds.width * 0.75, point.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.3, point.y, { steps: 5 });
    await page.mouse.up();
    expect(Number(await slider.inputValue())).toBeLessThan(mouseValue);
    await slider.press('Home');
    await expect(slider).toHaveValue((await slider.getAttribute('min')) ?? '0');
    await slider.press('End');
    await expect(slider).toHaveValue((await slider.getAttribute('max')) ?? '100');

    if (book.format === 'pdf' || book.format === 'djvu') {
      await slider.press('Home');
      await expect(slider).toHaveValue('0');
      const filter = page.locator('[data-filter-id="textEnhancement"]');
      await filter.getByRole('checkbox').check();
      const stroke = filter.getByRole('slider', { name: 'Толщина штриха', exact: true });
      await stroke.locator('..').click({ trial: true });
      const filterBounds = (await stroke.boundingBox())!;
      const start = {
        x: filterBounds.x + filterBounds.width * 0.5,
        y: filterBounds.y + filterBounds.height / 2,
      };
      const before = await stroke.inputValue();
      const scrollBefore = await scrollPosition(stroke);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await expect(stroke).toHaveValue(before);
      for (let step = 1; step <= 8; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: start.x, y: start.y - step * 12 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(stroke).toHaveValue(before);
      await expect.poll(() => scrollPosition(stroke)).toBeGreaterThan(scrollBefore + 20);
      await stroke.locator('..').click({ trial: true });
      const dragBounds = (await stroke.boundingBox())!;
      const drag = {
        x: dragBounds.x + dragBounds.width * 0.5,
        y: dragBounds.y + dragBounds.height / 2,
      };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drag] });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: drag.x - 40, y: drag.y }],
      });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const committed = Number(await stroke.inputValue());
      expect(committed).toBeLessThan(Number(before));
      await expect
        .poll(() =>
          page.evaluate((id) => {
            const preferences = JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}');
            return preferences.readers?.fixedLayout?.filterChains?.[id]?.find(
              (filter: { id: string }) => filter.id === 'textEnhancement',
            )?.strokeWidth;
          }, book.id),
        )
        .toBe(committed);
    }
    await session.detach();
  });
}
