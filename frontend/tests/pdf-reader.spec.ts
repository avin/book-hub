import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';
import { dragRangeToEnd } from './support/reader';
import {
  isWebglAvailable,
  openPdfFiltersPanel,
  parsePdfFilterChain,
  pdfAppliedFilterKey,
  pdfOutlineBookId,
  reorderPdfFilter,
} from './support/pdf-reader';

test('PDF reader использует те же правила открытия и закрытия chrome', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();

  const document = page.locator('[data-page-number="1"]');
  const searchInput = page.getByRole('search').getByRole('searchbox');

  await expect(document.locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');

  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'false');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');

  await page.keyboard.press('Control+f');
  await expect(searchInput).toBeFocused();
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');

  await searchInput.press('Escape');
  await document.dispatchEvent('pointerup', { pointerType: 'touch', clientY: 300 });
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');
});

test('PDF reader отключает оглавление без document outline', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);
  const tocButton = page.getByRole('button', { name: 'Оглавление недоступно' });
  await expect(tocButton).toBeDisabled();
});

test('PDF reader открывает панель фильтров и показывает параметры инверсии', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.mouse.move(10, 10);

  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();

  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });
  const strength = panel.getByRole('slider', { name: 'Сила' });

  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(invert).not.toBeChecked();
  await expect(strength).toBeHidden();

  await invert.check();
  await expect
    .poll(async () => {
      if (
        await panel
          .getByRole('alert')
          .isVisible()
          .catch(() => false)
      )
        return 'unavailable';
      if (await strength.isVisible().catch(() => false)) return 'available';
      return 'pending';
    })
    .toMatch(/available|unavailable/);

  if (await strength.isVisible()) {
    await expect(strength).toHaveValue('1');
    await expect.poll(() => pdfAppliedFilterKey(page)).toMatch(/"id":"invert","enabled":true/);
    await invert.uncheck();
    await expect(strength).toBeHidden();
    await expect.poll(() => pdfAppliedFilterKey(page)).toBe('');
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
    await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  }
});

test('PDF reader настраивает усиление текста, применяет его после ползунка и сбрасывает цепочку', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const panel = await openPdfFiltersPanel(page);
  const enhancement = panel.getByRole('checkbox', { name: 'Усиление текста' });
  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });
  const parameterNames = ['Толщина штриха', 'Порог', 'Контраст', 'Уровни серого', 'Сдвиг тона'];

  await expect(enhancement).not.toBeChecked();
  for (const name of parameterNames) {
    await expect(panel.getByRole('slider', { name })).toBeHidden();
  }

  await enhancement.check();
  const webglAvailable = await isWebglAvailable(page);

  if (webglAvailable) {
    await expect(panel.getByRole('slider', { name: 'Толщина штриха' })).toBeVisible();
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }

  if (await panel.getByRole('slider', { name: 'Толщина штриха' }).isVisible()) {
    await expect(panel.getByRole('slider', { name: 'Толщина штриха' })).toHaveValue('0.7');
    await expect(panel.getByRole('slider', { name: 'Порог' })).toHaveValue('0.62');
    await expect(panel.getByRole('slider', { name: 'Контраст' })).toHaveValue('1.85');
    await expect(panel.getByRole('slider', { name: 'Уровни серого' })).toHaveValue('8');
    await expect(panel.getByRole('slider', { name: 'Сдвиг тона' })).toHaveValue('-0.65');

    await dragRangeToEnd(page, panel.getByRole('slider', { name: 'Порог' }));
    await expect(panel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
    await expect
      .poll(async () => {
        const chain = parsePdfFilterChain(await pdfAppliedFilterKey(page));
        return chain?.find((filter) => filter.id === 'textEnhancement')?.threshold;
      })
      .not.toBe(0.62);

    await invert.check();
    await expect.poll(() => pdfAppliedFilterKey(page)).toMatch(/"id":"invert","enabled":true/);

    const searchInput = page.getByRole('search').getByRole('searchbox');
    await searchInput.fill('Page');
    await searchInput.press('Enter');
    await expect(page.getByTestId('pdf-text-layer').locator('.highlight')).toHaveCount(2);

    await reorderPdfFilter(page, 'invert', 'textEnhancement');
    await expect(panel.locator('[data-testid^="pdf-filter-item-"]').nth(0)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-invert',
    );

    await panel.getByRole('button', { name: 'Сбросить все' }).click();
    await expect(enhancement).not.toBeChecked();
    await expect(invert).not.toBeChecked();
    for (const name of parameterNames) {
      await expect(panel.getByRole('slider', { name })).toBeHidden();
    }
    await expect(panel.locator('[data-testid^="pdf-filter-item-"]').nth(0)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-textEnhancement',
    );
    await expect(panel.locator('[data-testid^="pdf-filter-item-"]').nth(1)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-invert',
    );
    await expect.poll(() => pdfAppliedFilterKey(page)).toBe('');

    await enhancement.check();
    await expect(panel.getByRole('slider', { name: 'Толщина штриха' })).toHaveValue('0.7');
    await expect(panel.getByRole('slider', { name: 'Порог' })).toHaveValue('0.62');
    await expect(panel.getByRole('slider', { name: 'Контраст' })).toHaveValue('1.85');
    await expect(panel.getByRole('slider', { name: 'Уровни серого' })).toHaveValue('8');
    await expect(panel.getByRole('slider', { name: 'Сдвиг тона' })).toHaveValue('-0.65');
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }
});

test('PDF reader меняет и сохраняет порядок выключенных фильтров', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const panel = await openPdfFiltersPanel(page);
  const filterItems = panel.locator('[data-testid^="pdf-filter-item-"]');
  const enhancement = panel.getByRole('checkbox', { name: 'Усиление текста' });
  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });

  await expect(filterItems).toHaveCount(6);
  await expect(filterItems.nth(0)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-textEnhancement',
  );
  await expect(filterItems.nth(1)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');
  await expect(filterItems.nth(5)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-softTextEnhancement',
  );

  await reorderPdfFilter(page, 'invert', 'textEnhancement');
  await expect(filterItems.nth(0)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');
  await expect(filterItems.nth(1)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-textEnhancement',
  );
  await expect(invert).not.toBeChecked();

  await expect
    .poll(() =>
      page.evaluate((bookId) => {
        const preferences = JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}');
        return preferences.readers?.pdf?.filterChains?.[bookId]?.map(
          (filter: { id: string }) => filter.id,
        );
      }, pdfOutlineBookId),
    )
    .toEqual([
      'invert',
      'textEnhancement',
      'visualAdjustment',
      'warmth',
      'grayscale',
      'softTextEnhancement',
    ]);

  if (await isWebglAvailable(page)) {
    await enhancement.check();
    await dragRangeToEnd(page, panel.getByRole('slider', { name: 'Порог' }));
    await expect(panel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
    await enhancement.uncheck();
    await expect(panel.getByRole('slider', { name: 'Порог' })).toBeHidden();

    await reorderPdfFilter(page, 'textEnhancement', 'invert');
    await expect(filterItems.nth(0)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-textEnhancement',
    );
    await expect(filterItems.nth(1)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');

    await enhancement.check();
    await invert.check();
    await expect(panel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
    await expect
      .poll(async () =>
        parsePdfFilterChain(await pdfAppliedFilterKey(page))?.map((filter) => filter.id),
      )
      .toEqual([
        'textEnhancement',
        'invert',
        'visualAdjustment',
        'warmth',
        'grayscale',
        'softTextEnhancement',
      ]);

    await reorderPdfFilter(page, 'invert', 'textEnhancement');
    await expect
      .poll(async () =>
        parsePdfFilterChain(await pdfAppliedFilterKey(page))?.map((filter) => filter.id),
      )
      .toEqual([
        'invert',
        'textEnhancement',
        'visualAdjustment',
        'warmth',
        'grayscale',
        'softTextEnhancement',
      ]);

    await invert.uncheck();
    await enhancement.uncheck();
  }

  await page.goto('/library');
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const reopenedPanel = await openPdfFiltersPanel(page);
  const reopenedItems = reopenedPanel.locator('[data-testid^="pdf-filter-item-"]');

  await expect(reopenedItems.nth(0)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');
  await expect(reopenedItems.nth(1)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-textEnhancement',
  );
  await expect(reopenedPanel.getByRole('checkbox', { name: 'Инверсия' })).not.toBeChecked();

  if (await isWebglAvailable(page)) {
    await reopenedPanel.getByRole('checkbox', { name: 'Усиление текста' }).check();
    await expect(reopenedPanel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
  }
});

test('PDF reader настраивает мягкое утолщение текста отдельно от исходного фильтра', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const panel = await openPdfFiltersPanel(page);
  const filter = panel.getByTestId('pdf-filter-item-softTextEnhancement');
  const toggle = filter.getByRole('checkbox', { name: 'Мягкое утолщение текста' });

  await expect(toggle).not.toBeChecked();
  await expect(filter.getByRole('slider', { name: 'Толщина штриха' })).toBeHidden();
  await expect(filter.getByRole('slider', { name: 'Сила' })).toBeHidden();

  await toggle.check();

  if (await isWebglAvailable(page)) {
    const strokeWidth = filter.getByRole('slider', { name: 'Толщина штриха' });
    const strength = filter.getByRole('slider', { name: 'Сила' });
    await expect(strokeWidth).toHaveValue('0.65');
    await expect(strength).toHaveValue('0.8');

    await dragRangeToEnd(page, strength);
    await expect(strength).not.toHaveValue('0.8');
    await expect
      .poll(async () => {
        const chain = parsePdfFilterChain(await pdfAppliedFilterKey(page));
        return chain?.find((item) => item.id === 'softTextEnhancement')?.strength;
      })
      .not.toBe(0.8);
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }
});

test('PDF reader сохраняет фильтры отдельно для каждой книги', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const preferences = {
      version: 1,
      readers: {
        pdf: {
          filterChains: {
            '00000000-0000-0000-0000-000000000103': [
              { id: 'invert', enabled: true, strength: 0.65 },
            ],
          },
        },
      },
    };
    localStorage.setItem('book-hub-preferences', JSON.stringify(preferences));
  });

  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  const firstPanel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  await expect(firstPanel.getByRole('checkbox', { name: 'Инверсия' })).toBeChecked();

  await page.goto('/library');
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  const secondPanel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  await expect(secondPanel.getByRole('checkbox', { name: 'Инверсия' })).not.toBeChecked();
});

test('PDF reader сохраняет исходное отображение без WebGL', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.evaluate(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: function getContext(type: string, ...args: unknown[]) {
        if (type === 'webgl') return null;
        return originalGetContext.call(this, type, ...(args as []));
      },
    });
  });
  expect(
    await page.evaluate(() => document.createElement('canvas').getContext('webgl')),
  ).toBeNull();
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  await panel.getByRole('checkbox', { name: 'Инверсия' }).check();
  await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
});

test('PDF reader открывает оглавление и переходит к пункту outline', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Second page' })).toBeVisible();
  await page.getByRole('button', { name: 'Second page' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pageTwo = [...document.querySelectorAll('[data-page-number="2"]')].at(0);
        if (!pageTwo) return null;
        return pageTwo.getBoundingClientRect().top;
      }),
    )
    .toBeLessThan(120);
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
});

test('PDF позволяет выделить и скопировать встроенный текст', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();

  const textLayer = page.getByTestId('pdf-text-layer').first();
  await expect(textLayer).toContainText('Book Hub PDF');

  const text = await textLayer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });

  expect(text).toContain('Book Hub PDF');
  expect(text).toContain('Reader story sample');
});

test('PDF reader показывает физическую страницу и ограничивает переход по номеру', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();

  await page.mouse.move(10, 10);
  const pageInput = page.getByRole('spinbutton', { name: 'Номер страницы' });
  await expect(pageInput).toHaveValue('1');
  await expect(page.getByText('/ 2', { exact: true })).toBeVisible();

  await pageInput.fill('999');
  await pageInput.press('Enter');
  await expect(pageInput).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await pageInput.fill('0');
  await pageInput.blur();
  await expect(pageInput).toHaveValue('1');
});

test('PDF reader ищет по текстовым слоям, подсвечивает совпадения и синхронизирует страницу', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);

  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  const nextButton = search.getByRole('button', { name: 'Найти следующее' });
  const previousButton = search.getByRole('button', { name: 'Найти предыдущее' });
  const pdfHighlights = page.getByTestId('pdf-text-layer').locator('.highlight');

  await searchInput.fill('Page');
  await expect(search.getByText('0/0')).toBeVisible();
  await searchInput.press('Enter');
  await expect(search.getByText('1/2')).toBeVisible();
  await expect(pdfHighlights).toHaveCount(2);
  await expect(page.getByTestId('pdf-text-layer').locator('.highlight.selected')).toHaveCount(1);

  await searchInput.fill('One Page');
  await expect(search.getByText('1/2')).toBeVisible();
  await searchInput.press('Enter');
  await expect(search.getByText('0/0')).toBeVisible();
  await expect(pdfHighlights).toHaveCount(0);

  const pageInput = page.getByRole('spinbutton', { name: 'Номер страницы' });
  await pageInput.fill('1');
  await pageInput.press('Enter');
  await searchInput.fill('Page');
  await searchInput.press('Enter');
  await expect(search.getByText('1/2')).toBeVisible();

  const progressResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/books/00000000-0000-0000-0000-000000000103/progress`) &&
      response.request().method() === 'PUT',
  );
  await nextButton.click();
  await expect(search.getByText('2/2')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('2');
  await progressResponse;

  await previousButton.click();
  await expect(search.getByText('1/2')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');

  await nextButton.click();
  await expect(search.getByText('2/2')).toBeVisible();
  await nextButton.click();
  await expect(search.getByText('1/2')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');

  await page.locator('[data-page-number="1"]').dispatchEvent('click');
  await expect(pdfHighlights).toHaveCount(0);
  await expect(searchInput).toHaveValue('Page');

  await page.mouse.move(10, 10);
  await searchInput.press('Enter');
  await expect(search.getByText('1/2')).toBeVisible();

  await searchInput.press('Escape');
  await expect(pdfHighlights).toHaveCount(0);
  await expect(searchInput).toHaveValue('Page');
});

test('PDF без текстового слоя не запускает OCR и не показывает совпадения', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/books/00000000-0000-0000-0000-000000000102/file', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: bookMocks.pdfFileWithoutText,
    }),
  );
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);

  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');

  await searchInput.fill('текст');
  await searchInput.press('Enter');
  await expect(search.getByText('0/0')).toBeVisible();
  await expect(page.getByTestId('pdf-text-layer').locator('.highlight')).toHaveCount(0);
});

test('PDF поисковое выделение совпадает с геометрией найденного текста', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();

  const textLayer = page.getByTestId('pdf-text-layer').first();
  await expect(textLayer).toContainText('Reader story sample');
  const expected = await textLayer.evaluate((layer) => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const text = node.textContent ?? '';
      const start = text.indexOf('Reader');

      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 'Reader'.length);
        const rect = range.getBoundingClientRect();

        return { left: rect.left, width: rect.width, height: rect.height };
      }

      node = walker.nextNode();
    }

    return null;
  });

  expect(expected).not.toBeNull();
  await page.mouse.move(10, 10);
  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  await searchInput.fill('Reader');
  await searchInput.press('Enter');

  const actualMark = page.getByTestId('pdf-text-layer').locator('.highlight.selected').first();
  await expect(actualMark).toHaveText('Reader');
  await expect(actualMark).toBeVisible();
  let actual: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(async () => {
      actual = await actualMark.boundingBox();
      return actual !== null;
    })
    .toBe(true);
  const actualText = await actualMark.textContent();
  expect(actualText).toBe('Reader');
  expect(actual).not.toBeNull();
  if (!expected || !actual) return;

  expect(Math.abs(actual.x - expected.left)).toBeLessThan(2);
  expect(Math.abs(actual.width - expected.width)).toBeLessThan(2);
  expect(Math.abs(actual.height - expected.height)).toBeLessThan(2);
});
