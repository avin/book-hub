import { readFile } from 'node:fs/promises';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

test.use({ viewport: { width: 390, height: 600 }, hasTouch: true, isMobile: true });

const book = { ...books.items[0], id: '00000000-0000-0000-0000-000000000105', format: 'djvu' };

async function scrollPosition(slider: Locator) {
  return slider.evaluate((element) => {
    let parent = element.parentElement;
    while (parent && getComputedStyle(parent).overflowY !== 'auto') {
      parent = parent.parentElement;
    }
    return parent?.scrollTop ?? 0;
  });
}

async function sliderPoint(slider: Locator, ratio = 0.5) {
  await slider.locator('..').click({ trial: true });
  const bounds = (await slider.boundingBox())!;
  return { x: bounds.x + 8 + (bounds.width - 16) * ratio, y: bounds.y + bounds.height / 2 };
}

async function swipeVertically(session: CDPSession, point: { x: number; y: number }) {
  for (let step = 1; step <= 8; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y - step * 12 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function widthSlider(page: Page) {
  return page.getByRole('slider', { name: 'Увеличение ширины', exact: true });
}

// Each gesture starts in a fresh page: a previous vertical swipe can keep scrolling
// through compositor inertia even after assigning scrollTop = 0.
test.beforeEach(async ({ page, api }) => {
  await api.intercept({ method: 'GET', path: `/v1/books/${book.id}` }, book);
  const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
  await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
    route.fulfill({ contentType: 'image/vnd.djvu', body: file }),
  );
  await login(page);
  await page.goto(`/reader/${book.id}`);
  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
  await page.touchscreen.tap(195, 300);
  await page.getByRole('button', { name: 'Внешний вид', exact: true }).tap();
  await expect(page.locator('aside').filter({ hasText: 'Внешний вид' })).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 0)',
  );
});

for (const onThumb of [false, true]) {
  test(`DJVU: вертикальный свайп ${onThumb ? 'с бегунка' : 'со шкалы'} прокручивает настройки, сохраняя значение`, async ({
    page,
  }) => {
    const slider = widthSlider(page);
    const initial = await slider.inputValue();
    const ratio = !onThumb
      ? 0.8
      : await slider.evaluate(
          (element: HTMLInputElement) =>
            (element.valueAsNumber - Number(element.min)) /
            (Number(element.max) - Number(element.min)),
        );
    const point = await sliderPoint(slider, ratio);
    const scrollBefore = await scrollPosition(slider);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(slider).toHaveValue(initial);
    await swipeVertically(session, point);
    await expect(slider).toHaveValue(initial);
    await expect.poll(() => scrollPosition(slider)).toBeGreaterThan(scrollBefore + 20);
    await session.detach();
  });
}

test('DJVU: тап и горизонтальный жест не прокручивают настройки; мышь и клавиатура меняют значение', async ({
  page,
}) => {
  const slider = widthSlider(page);
  const point = await sliderPoint(slider);
  const bounds = (await slider.boundingBox())!;
  const initial = await slider.inputValue();
  const scrollBefore = await scrollPosition(slider);
  const session = await page.context().newCDPSession(page);
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
  await expect.poll(() => scrollPosition(slider)).toBe(scrollBefore);

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
  await session.detach();
});

test.describe('DJVU: сенсорное управление фильтром', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('[data-filter-id="textEnhancement"]').getByRole('checkbox').check();
  });

  test('вертикальный свайп прокручивает настройки, сохраняя толщину штриха', async ({ page }) => {
    const stroke = page.getByRole('slider', { name: 'Толщина штриха', exact: true });
    const point = await sliderPoint(stroke);
    const before = await stroke.inputValue();
    const scrollBefore = await scrollPosition(stroke);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(stroke).toHaveValue(before);
    await swipeVertically(session, point);
    await expect(stroke).toHaveValue(before);
    await expect.poll(() => scrollPosition(stroke)).toBeGreaterThan(scrollBefore + 20);
    await session.detach();
  });

  test('горизонтальный жест меняет и сохраняет толщину штриха', async ({ page }) => {
    const stroke = page.getByRole('slider', { name: 'Толщина штриха', exact: true });
    const point = await sliderPoint(stroke);
    const before = await stroke.inputValue();
    const scrollBefore = await scrollPosition(stroke);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x - 40, y: point.y }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const committed = Number(await stroke.inputValue());
    expect(committed).toBeLessThan(Number(before));
    await expect.poll(() => scrollPosition(stroke)).toBe(scrollBefore);
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
    await session.detach();
  });
});
