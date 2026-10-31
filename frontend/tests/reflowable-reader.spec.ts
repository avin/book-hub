import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';

type ReflowableReaderFixture = {
  bookTitle: string;
  initialHeading: string;
  searchQuery: string;
  tocEntry: string;
  tocHeading: string;
  footnoteText: string;
};

async function showReaderChrome(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
}

async function verifyReflowableReader(page: Page, fixture: ReflowableReaderFixture) {
  await page.setViewportSize({ width: 640, height: 480 });
  await login(page);
  await page
    .getByRole('heading', { name: fixture.bookTitle, exact: true })
    .getByRole('link')
    .click();
  await expect(page.getByRole('heading', { name: fixture.initialHeading })).toBeVisible();

  await showReaderChrome(page);
  const search = page.getByRole('searchbox', { name: 'Поиск по книге' });
  await search.fill(fixture.searchQuery);
  await search.press('Enter');
  await expect(page.locator('[data-search-match]')).not.toHaveCount(0);

  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Оглавление' }).click();
  const tocPanel = page.locator('aside').filter({ hasText: 'Оглавление' });
  await tocPanel.getByRole('button', { name: fixture.tocEntry, exact: true }).click();
  await tocPanel.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('heading', { name: fixture.tocHeading })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: '[1]' }).click();
  const footnote = page.getByRole('dialog');
  await expect(footnote).toContainText(fixture.footnoteText);
  await footnote.getByRole('button', { name: 'Закрыть сноску' }).click();

  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const settingsPanel = page.locator('aside').filter({ hasText: 'Внешний вид' });
  const fontSize = settingsPanel.locator('input[type="range"]').first();
  const initialFontSize = await fontSize.inputValue();
  await fontSize.press('ArrowRight');
  await expect(fontSize).not.toHaveValue(initialFontSize);
  await fontSize.press('End');
  await expect(fontSize).toHaveValue('90');
  await expect(settingsPanel).toContainText('90px');
  await expect(page.locator('article')).toHaveCSS('--fb2-font-size', '90px');

  const lineHeight = settingsPanel.getByRole('slider').nth(1);
  await lineHeight.press('Home');
  await expect(lineHeight).toHaveValue('1');
  await expect(page.locator('article')).toHaveCSS('--fb2-line-height', '1');

  const paragraphIndent = settingsPanel.getByRole('slider').nth(2);
  await paragraphIndent.press('End');
  await expect(paragraphIndent).toHaveValue('256');
  await expect(page.locator('article')).toHaveCSS('--fb2-paragraph-indent', '256px');

  const paragraphSpacing = settingsPanel.getByRole('slider').nth(3);
  await paragraphSpacing.press('End');
  await expect(paragraphSpacing).toHaveValue('120');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const preferences = JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}');
        return preferences.readers?.fb2?.settings;
      }),
    )
    .toMatchObject({ fontSize: 90, lineHeight: 1, paragraphIndent: 256, paragraphSpacing: 120 });
  await settingsPanel.getByRole('button', { name: 'Закрыть' }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);
  const savedProgress = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/progress'),
  );
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  const progressRequest = await savedProgress;
  const progress = JSON.parse(progressRequest.postData() ?? '{}') as { progress_percent?: number };
  expect(progress.progress_percent).toBeGreaterThan(0);
}

test('читатель FB2 сохраняет общий reflowable сценарий', async ({ page }) => {
  await verifyReflowableReader(page, {
    bookTitle: 'Война и мир',
    initialHeading: 'Глава первая',
    searchQuery: 'Глава 2, абзац',
    tocEntry: 'Глава 2',
    tocHeading: 'Глава 2',
    footnoteText: 'Текст тестовой сноски.',
  });
});

test('читатель EPUB сохраняет общий reflowable сценарий', async ({ page }) => {
  await verifyReflowableReader(page, {
    bookTitle: 'EPUB для проверки',
    initialHeading: 'Глава EPUB',
    searchQuery: 'Текст EPUB',
    tocEntry: 'Глава EPUB',
    tocHeading: 'Глава EPUB',
    footnoteText: 'Текст EPUB-сноски.',
  });
});

for (const bookTitle of ['Война и мир', 'EPUB для проверки']) {
  test(`боковые отступы регулируются, сохраняются и сбрасываются: ${bookTitle}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page);
    await page.getByRole('heading', { name: bookTitle, exact: true }).getByRole('link').click();
    await expect(page.locator('main article')).toBeVisible();
    await expect(page.locator('main')).toHaveCSS('padding-left', '8px');
    await expect(page.locator('main')).toHaveCSS('padding-right', '8px');
    await showReaderChrome(page);
    await page.getByRole('button', { name: 'Внешний вид' }).click();
    const padding = page.getByRole('slider', { name: 'Боковые отступы', exact: true });
    await expect(padding).toHaveValue('8');
    await padding.press('Home');
    await expect(padding).toHaveValue('2');
    await expect(page.locator('main')).toHaveCSS('padding-left', '2px');
    await expect(page.locator('main article')).toHaveCSS('width', '386px');
    await padding.press('End');
    await expect(padding).toHaveValue('32');
    await expect(page.locator('main')).toHaveCSS('padding-right', '32px');
    await expect(page.locator('main article')).toHaveCSS('width', '326px');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const preferences = JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}');
          return preferences.readers?.fb2?.settings?.sidePadding;
        }),
      )
      .toBe(32);

    await page.reload();
    await expect(page.locator('main')).toHaveCSS('padding-left', '32px');
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.locator('main')).toHaveCSS('padding-right', '32px');
    await showReaderChrome(page);
    await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
    const otherTitle = bookTitle === 'Война и мир' ? 'EPUB для проверки' : 'Война и мир';
    await page.getByRole('heading', { name: otherTitle, exact: true }).getByRole('link').click();
    await expect(page.locator('main')).toHaveCSS('padding-left', '32px');
    await showReaderChrome(page);
    await page.getByRole('button', { name: 'Внешний вид' }).click();
    await expect(padding).toHaveValue('32');
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await expect(padding).toHaveValue('8');
    await expect(page.locator('main')).toHaveCSS('padding-left', '8px');
  });
}

test('изменение боковых отступов сохраняет видимый текстовый блок', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  await expect(page.locator('main article')).toBeVisible();
  await showReaderChrome(page);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const padding = page.getByRole('slider', { name: 'Боковые отступы', exact: true });
  await padding.focus();
  await page.evaluate(() => window.scrollTo(0, 4000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(4000);
  const anchor = await page.locator('article > div').evaluateAll((elements) => {
    const slot = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return element.textContent && rect.top <= 0 && rect.bottom > 0;
    })!;
    return { text: slot.textContent!, top: slot.getBoundingClientRect().top };
  });
  await padding.press('End');
  await expect(page.locator('main article')).toHaveCSS('width', '326px');
  const block = page.getByText(anchor.text, { exact: true });
  await expect
    .poll(() => block.evaluate((element) => element.parentElement!.getBoundingClientRect().top))
    .toBeCloseTo(anchor.top, 0);
  await padding.press('Home');
  await expect(page.locator('main article')).toHaveCSS('width', '386px');
  await expect
    .poll(() => block.evaluate((element) => element.parentElement!.getBoundingClientRect().top))
    .toBeCloseTo(anchor.top, 0);
});

test('Literata не обрезает абзац после загрузки кириллицы', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'book-hub-preferences',
      JSON.stringify({
        version: 1,
        language: 'ru',
        readers: {
          fb2: {
            settings: {
              fontFamily: '"Literata", "Noto Serif", "Noto Sans", serif',
              fontSize: 46,
              lineHeight: 1.3,
              paragraphIndent: 29,
              paragraphSpacing: 36,
              maxTextWidth: 1063,
            },
          },
        },
      }),
    );
  });
  let releaseFont!: () => void;
  const fontGate = new Promise<void>((resolve) => {
    releaseFont = resolve;
  });
  await page.route('**/normal-200-900-cyrillic*.woff2', async (route) => {
    await fontGate;
    await route.continue();
  });
  await page.route('**/api/v1/books/00000000-0000-0000-0000-000000000101/file', (route) =>
    route.fulfill({
      contentType: 'application/xml',
      body: '<FictionBook><body><section><p>— Смотря какой шрифт, — возразил Дмитрий.</p></section></body></FictionBook>',
    }),
  );
  await login(page);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  const paragraph = page.locator('article p');
  try {
    await expect(paragraph).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('46px "Literata"')))
      .toBe(true);
    expect(await page.evaluate(() => document.fonts.check('46px "Literata"', 'Дмитрий'))).toBe(
      false,
    );
  } finally {
    releaseFont();
  }
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      paragraph.evaluate((element) => {
        const slot = element.parentElement!;
        return element.getBoundingClientRect().bottom - slot.getBoundingClientRect().bottom;
      }),
    )
    .toBeLessThanOrEqual(1);
});
