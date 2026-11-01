import type { Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { expect, test } from './fixtures';
import { login } from './support/api';

const books = [
  { title: 'Война и мир', id: '00000000-0000-0000-0000-000000000101', format: 'fb2' },
  { title: 'EPUB для проверки', id: '00000000-0000-0000-0000-000000000104', format: 'epub' },
] as const;

const paragraphs = Array.from(
  { length: 400 },
  (_, index) =>
    `<p>Абзац ${index + 1}. Текст длинной книги для проверки восстановления позиции с первого видимого кадра. Кириллица и Latin, <strong>выделение</strong> и <em>курсив</em>.</p>`,
).join('');
const epub = Buffer.from(
  zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    ),
    'book.opf': strToU8(
      '<package><metadata/><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>',
    ),
    'text.xhtml': strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body>${paragraphs}</body></html>`,
    ),
  }),
);

type StartupWindow = Window & { startupSamples: number[] };

async function observeVisibleFrames(page: Page) {
  await page.addInitScript(() => {
    const samples: number[] = [];
    Object.assign(window, { startupSamples: samples });
    const sample = () => {
      if (location.pathname.startsWith('/reader/')) {
        const article = document.querySelector('main article');
        const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        if (article?.querySelector('p') && hit?.closest('main')) {
          const maxScroll = document.documentElement.scrollHeight - innerHeight;
          samples.push(maxScroll > 0 ? (scrollY / maxScroll) * 100 : 0);
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function expectOnlySavedPosition(page: Page, progress: number) {
  await expect
    .poll(() => page.evaluate(() => (window as StartupWindow).startupSamples.length))
    .toBeGreaterThan(0);
  // Covers late font/resize events and the former delayed second restoration.
  await page.waitForTimeout(1000);
  const samples = await page.evaluate(() => (window as StartupWindow).startupSamples);
  expect(samples.filter((value) => Math.abs(value - progress) > 0.5)).toEqual([]);
}

for (const book of books) {
  for (const progress of [0, 65, 100]) {
    test(`${book.format}: первый кадр на ${progress}% и повторное открытие`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      if (progress === 65) {
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      }
      const writes: number[] = [];
      await page.route(`**/api/v1/books/${book.id}/progress`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { progress_percent: progress } });
        writes.push(route.request().postDataJSON().progress_percent);
        return route.fallback();
      });
      if (book.format === 'epub') {
        await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
          route.fulfill({ contentType: 'application/epub+zip', body: epub }),
        );
      }
      await observeVisibleFrames(page);
      await login(page);
      await page.getByRole('heading', { name: book.title, exact: true }).getByRole('link').click();
      await expectOnlySavedPosition(page, progress);
      expect(writes).toEqual([]);
      await page.reload();
      await expectOnlySavedPosition(page, progress);
      expect(writes).toEqual([]);
      const saved = page.waitForRequest(
        (request) => request.method() === 'PUT' && request.url().endsWith('/progress'),
      );
      await page.evaluate(() =>
        window.scrollTo({
          top: (document.documentElement.scrollHeight - innerHeight) * 0.2,
          behavior: 'instant',
        }),
      );
      expect((await saved).postDataJSON().progress_percent).toBeCloseTo(20, 0);
    });
  }

  test(`${book.format}: ожидает ответ прогресса и открывается при его ошибке`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/books/${book.id}/progress`, async (route) => {
      await gate;
      return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
    });
    await login(page);
    await page.getByRole('heading', { name: book.title, exact: true }).getByRole('link').click();
    try {
      await expect(page.getByRole('status', { name: 'Загрузка' }).first()).toBeVisible();
      await expect(page.locator('article p')).not.toBeVisible();
    } finally {
      release();
    }
    await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  });
}

test('ошибка шрифта не оставляет FB2 под загрузкой', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'book-hub-preferences',
      JSON.stringify({
        language: 'ru',
        readers: { fb2: { settings: { fontFamily: '"Literata", serif' } } },
      }),
    ),
  );
  await page.route('**/*.woff2', (route) => route.abort());
  await login(page);
  await page.getByRole('heading', { name: books[0].title, exact: true }).getByRole('link').click();
  await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
});

test('ошибка EPUB остаётся видна после завершения загрузки', async ({ page }) => {
  await page.route(`**/api/v1/books/${books[1].id}/file`, (route) =>
    route.fulfill({ body: 'invalid epub' }),
  );
  await login(page);
  await page.getByRole('heading', { name: books[1].title, exact: true }).getByRole('link').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Загрузка' })).toHaveCount(0);
});

test('ошибка фонового расчёта показывает ошибку страницы и допускает повтор', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = { fail: true };
    Object.assign(window, { metricsState: state });
    for (const prototype of [
      CanvasRenderingContext2D.prototype,
      OffscreenCanvasRenderingContext2D.prototype,
    ]) {
      const measure = prototype.measureText;
      prototype.measureText = function (text: string) {
        if (state.fail) throw new Error('Text measurement failed');
        return measure.call(this, text);
      };
    }
  });
  await login(page);
  await page.getByRole('heading', { name: books[0].title, exact: true }).getByRole('link').click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    (window as unknown as { metricsState: { fail: boolean } }).metricsState.fail = false;
  });
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
});

test('уход во время загрузки шрифта отменяет открытие книги', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'book-hub-preferences',
      JSON.stringify({
        language: 'ru',
        readers: { fb2: { settings: { fontFamily: '"Literata", serif' } } },
      }),
    ),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*cyrillic*.woff2', async (route) => {
    await gate;
    await route.continue();
  });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/progress'))
      writes.push(request.url());
  });
  await login(page);
  await page.getByRole('heading', { name: books[0].title, exact: true }).getByRole('link').click();
  try {
    await expect(page.locator('main')).toHaveCSS('visibility', 'hidden');
    await page.goBack();
    await expect(page).toHaveURL(/\/library$/);
  } finally {
    release();
  }
  await page.getByRole('heading', { name: books[1].title, exact: true }).getByRole('link').click();
  await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
  expect(writes).toEqual([]);
});
