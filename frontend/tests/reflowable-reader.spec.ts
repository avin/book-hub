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
  await expect(fontSize).toHaveValue('60');
  await expect(settingsPanel).toContainText('60px');
  await expect(page.locator('article')).toHaveCSS('--fb2-font-size', '60px');
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
