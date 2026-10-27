import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';
import { req } from './mocks/auth';
import { themeIds } from '../src/styles/themes';
import * as bookMocks from './mocks/books';

async function expectHeight(control: Locator, height: number) {
  await expect(control).toBeVisible();
  await expect
    .poll(() => control.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(height);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

// Read rendered colors, including color-mix() and translucent feedback surfaces.
async function contrastRatio(
  element: Locator,
  foregroundProperty: 'color' | 'borderTopColor' = 'color',
) {
  return element.evaluate((element, foregroundProperty) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const blend = (foreground: number[], background: number[]) => {
      const alpha = foreground[3] / 255;
      return [0, 1, 2].map(
        (channel) => foreground[channel] * alpha + background[channel] * (1 - alpha),
      );
    };
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      ancestors.unshift(current);
    }
    let background = [255, 255, 255];
    for (const ancestor of ancestors) {
      background = blend(rgba(getComputedStyle(ancestor).backgroundColor), background);
    }
    const foreground = blend(rgba(getComputedStyle(element)[foregroundProperty]), background);
    const luminance = (color: number[]) =>
      color.reduce((sum, value, channel) => {
        const normalized = value / 255;
        const linear =
          normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][channel];
      }, 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }, foregroundProperty);
}

test('поля, селекты и кнопки используют общую высоту', async ({ page }) => {
  await page.goto('/login');
  await expectHeight(page.locator('#login'), 40);
  await expectHeight(page.locator('#password'), 40);
  await expectHeight(page.getByRole('button', { name: 'Войти', exact: true }), 40);
  await expectHeight(page.getByRole('button', { name: 'Язык', exact: true }), 40);
  const radius = await page
    .locator('#login')
    .evaluate((element) => getComputedStyle(element).borderRadius);

  await login(page);
  const search = page.getByRole('textbox', { name: 'Поиск книг', exact: true });
  const tags = page.getByRole('combobox', { name: 'Теги', exact: true });
  await expectHeight(search.locator('..'), 40);
  await expectHeight(tags.locator('..'), 40);
  await expectHeight(page.getByRole('button', { name: 'Сортировка', exact: true }), 40);
  await expectHeight(page.getByRole('link', { name: 'Загрузить книгу', exact: true }), 40);
  await expectHeight(page.getByRole('button', { name: 'Язык', exact: true }), 40);
  await expect(search.locator('..')).toHaveCSS('border-radius', radius);
  await expect(tags.locator('..')).toHaveCSS('border-radius', radius);
  await expect(page.getByRole('button', { name: 'Язык', exact: true })).toHaveCSS(
    'border-radius',
    radius,
  );

  // Adding chips must not change the height of the composite control.
  await tags.fill('роман');
  await tags.press('Enter');
  await expectHeight(tags.locator('..'), 40);
  await expectHeight(
    page.getByRole('button', { name: 'Сбросить фильтр', exact: true }).first(),
    32,
  );
});

for (const width of [375, 1280]) {
  test(`основные страницы и диалог помещаются в экран ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await expect(page.locator('#login')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`login-${width}.png`), fullPage: true });
    await login(page);

    for (const path of ['/library', '/upload', '/settings']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (path === '/library') {
        const sort = page.getByRole('button', { name: 'Сортировка', exact: true });
        const view = page.getByRole('button', { name: 'Список', exact: true });
        await expect
          .poll(async () => {
            const sortBounds = await sort.boundingBox();
            const viewBounds = await view.boundingBox();
            return Math.abs(
              sortBounds!.y + sortBounds!.height / 2 - (viewBounds!.y + viewBounds!.height / 2),
            );
          })
          .toBeLessThanOrEqual(1);
      }
      await page.screenshot({
        path: test.info().outputPath(`${path.slice(1)}-${width}.png`),
        fullPage: true,
      });
    }

    await page.goto('/library');
    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: 'Действия с книгой' })
      .click();
    await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`edit-${width}.png`), fullPage: true });
  });
}

for (const theme of themeIds) {
  test(`контраст кнопки и сообщений в теме ${theme}`, async ({ page, api }) => {
    await page.addInitScript((theme) => {
      const key = 'book-hub-preferences';
      const preferences = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...preferences, theme }));
    }, theme);
    await api.intercept(
      req.login,
      {
        code: 'unauthorized',
        message: 'unauthorized',
        request_id: 'design-system',
      },
      401,
    );
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (theme.startsWith('dark-')) {
      const input = page.locator('#login');
      const borderContrast = await contrastRatio(input, 'borderTopColor');
      expect(borderContrast, `${theme}: input border`).toBeGreaterThanOrEqual(3);
      await input.hover();
      await expect
        .poll(() => contrastRatio(input, 'borderTopColor'), {
          message: `${theme}: input hover border`,
        })
        .toBeGreaterThan(borderContrast);
    }
    const button = page.getByRole('button', { name: 'Войти', exact: true });
    await expect(button).toBeVisible();
    expect(await contrastRatio(button), `${theme}: primary button`).toBeGreaterThanOrEqual(4.5);
    await button.hover();
    await button.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    expect(await contrastRatio(button), `${theme}: primary button hover`).toBeGreaterThanOrEqual(
      4.5,
    );
    await page.locator('#login').fill('reader');
    await page.locator('#password').fill('secret');
    await button.click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    expect(await contrastRatio(alert), `${theme}: error feedback`).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('tab', { name: 'Регистрация', exact: true }).click();
    await page.locator('#repeat-password').fill('secret');
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    const success = page.getByRole('status');
    await expect(success).toBeVisible();
    expect(await contrastRatio(success), `${theme}: success feedback`).toBeGreaterThanOrEqual(4.5);
  });
}

test('ошибка поля сохраняет цвет и заметный фокус без изменения геометрии', async ({ page }) => {
  await page.goto('/login');
  const input = page.locator('#login');
  const initialBounds = await input.boundingBox();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.focus();
  await expect(input).toBeFocused();
  await expectHeight(input, 40);
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const style = getComputedStyle(element);
        const sample = document.createElement('span');
        sample.style.color = 'var(--danger)';
        element.parentElement!.appendChild(sample);
        const danger = getComputedStyle(sample).color;
        sample.remove();
        return style.borderTopColor === danger && style.boxShadow !== 'none';
      }),
    )
    .toBe(true);
  expect((await input.boundingBox())!.width).toBe(initialBounds!.width);
});

async function openReaderSettings(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await page.getByRole('button', { name: 'Внешний вид', exact: true }).click();
  const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
  await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  return panel;
}

test('FB2 и EPUB сохраняют размеры и шрифт интерфейса при изменении текста книги', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  for (const format of ['fb2', 'epub']) {
    const book = bookMocks.items.find((book) => book.format === format)!;
    await page.goto(`/reader/${book.id}`);
    const article = page.locator('article');
    await expect(article).toBeVisible();
    const panel = await openReaderSettings(page);
    const font = panel.locator('select');
    await expectHeight(font, 40);
    for (const color of await panel.locator('input[type="color"]').all()) {
      await expectHeight(color, 40);
    }
    await expectHeight(page.getByRole('searchbox', { name: 'Поиск по книге' }), 32);
    await expectHeight(panel.getByRole('button', { name: 'Закрыть', exact: true }), 40);

    const readUiMetrics = () =>
      panel.evaluate((element) =>
        [element, ...element.querySelectorAll('h2, h3, select, input, button')].map((control) => {
          const style = getComputedStyle(control);
          const bounds = control.getBoundingClientRect();
          return {
            font: style.fontFamily,
            size: style.fontSize,
            lineHeight: style.lineHeight,
            width: bounds.width,
            height: bounds.height,
          };
        }),
      );
    const initialUi = await readUiMetrics();
    const initialBookFont = await article.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--fb2-font-family'),
    );
    await font.selectOption({
      label: initialBookFont.includes('Literata') ? 'Cousine' : 'Literata',
    });
    await panel.locator('input[type="range"]').first().fill('60');
    await expect(article).toHaveCSS('--fb2-font-size', '60px');
    await expect
      .poll(() =>
        article.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--fb2-font-family'),
        ),
      )
      .not.toBe(initialBookFont);
    await expect.poll(readUiMetrics).toEqual(initialUi);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`${format}-appearance.png`) });
  }
});

test('PDF и DJVU используют одинаковую панель и компактные контролы читалки', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  const djvuBookId = '00000000-0000-0000-0000-000000000105';
  const djvu = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
  await page.route(`**/api/v1/books/${djvuBookId}`, (route) =>
    route.fulfill({
      json: { ...bookMocks.items[0], id: djvuBookId, format: 'djvu' },
    }),
  );
  await page.route(`**/api/v1/books/${djvuBookId}/file`, (route) =>
    route.fulfill({
      contentType: 'image/vnd.djvu',
      body: djvu,
    }),
  );
  let panelSize: { width: number; height: number } | undefined;
  for (const [format, id] of [
    ['pdf', bookMocks.items.find((book) => book.title === 'PDF с оглавлением')!.id],
    ['djvu', djvuBookId],
  ]) {
    await page.goto(`/reader/${id}`);
    await expect(page.locator('[data-page-number="1"] canvas').first()).toBeVisible({
      timeout: 30_000,
    });
    const panel = await openReaderSettings(page);
    await expectHeight(panel.getByRole('button', { name: 'Закрыть', exact: true }), 40);
    await expectHeight(panel.getByRole('slider', { name: 'Увеличение ширины', exact: true }), 32);
    await expectHeight(panel.getByRole('checkbox', { name: 'Инверсия', exact: true }), 16);
    await expectHeight(page.getByTestId('reader-floating-footer').getByRole('button').last(), 32);
    if (format === 'pdf') {
      await expectHeight(page.getByRole('searchbox', { name: 'Поиск по книге' }), 32);
    }
    const bounds = (await panel.boundingBox())!;
    const size = { width: bounds.width, height: bounds.height };
    if (panelSize) expect(size).toEqual(panelSize);
    panelSize = size;
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`${format}-appearance.png`) });
  }
});
