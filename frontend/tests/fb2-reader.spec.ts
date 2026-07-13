import { expect, test } from './fixtures';
import { login } from './support/api';
import {
  anchorBounds,
  anchorTop,
  dragRangeToEnd,
  moveToAnchor,
  openReader,
  openReaderSettings,
  openReaderToc,
  readerBookId,
} from './support/reader';

test('читатель FB2 загружает книгу и сохраняет избранное/прогресс через моки', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать из избранного' }).dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Добавить в избранное' })).toBeVisible();
  await page.getByRole('link', { name: 'Библиотека' }).dispatchEvent('click');
  await expect(page).toHaveURL(/\/library$/);
});

test('общий reader chrome открывается с клавиатуры и закрывается с сохранением запроса', async ({
  page,
}) => {
  await openReader(page);

  const searchInput = page.getByRole('search').getByRole('searchbox');

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await expect(searchInput).toBeFocused();
  await expect(page.getByRole('search').getByText('0/0')).toBeVisible();
  await searchInput.fill('сохранённый запрос');
  await searchInput.blur();
  await searchInput.focus();
  await page.keyboard.type('новый запрос');
  await expect(searchInput).toHaveValue('новый запрос');
  await searchInput.press('Escape');

  const document = page.locator('main');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');
  await document.dispatchEvent('pointerup', { pointerType: 'touch', clientY: 300 });
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');

  await page.mouse.move(10, 10);
  await expect(searchInput).toHaveValue('новый запрос');
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
});

test('поиск FB2 запускается явно, подсвечивает сноски и циклически навигируется', async ({
  page,
}) => {
  await openReader(page);

  await page.mouse.move(10, 10);
  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  const nextButton = search.getByRole('button', { name: 'Найти следующее' });
  const previousButton = search.getByRole('button', { name: 'Найти предыдущее' });

  await expect(search.getByText('0/0')).toBeVisible();
  await searchInput.fill('  тестовой   сноски  ');
  await expect(search.getByText('0/0')).toBeVisible();
  await expect(page.locator('mark[data-search-match]')).toHaveCount(0);

  await searchInput.press('Enter');
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(page.locator('mark[data-search-match]').first()).toBeVisible();
  await expect(page.locator('mark[data-search-match][data-search-active="true"]')).toHaveCount(1);

  const progressResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/books/${readerBookId}/progress`) &&
      response.request().method() === 'PUT',
  );
  await nextButton.click();
  await progressResponse;
  await expect(search.getByText('1/1')).toBeVisible();

  await previousButton.click();
  await expect(search.getByText('1/1')).toBeVisible();

  await searchInput.press('Escape');
  await expect(page.locator('mark[data-search-match]')).toHaveCount(0);
  await page.mouse.move(10, 10);
  await expect(searchInput).toHaveValue('  тестовой   сноски  ');

  await searchInput.press('Enter');
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(page.locator('mark[data-search-match]').first()).toBeVisible();

  await searchInput.fill('Глава');
  await expect(search.getByText('1/1')).toBeVisible();
  await searchInput.press('Enter');
  const searchCount = search.locator('[aria-live="polite"]');
  await expect(searchCount).toHaveText(/\d+\/\d+/);
  const [initialMatch, totalMatches] = ((await searchCount.textContent()) ?? '')
    .split('/')
    .map(Number);
  expect(initialMatch).toBeGreaterThan(0);
  expect(totalMatches).toBeGreaterThan(1);
  await nextButton.click();
  await expect(searchCount).toHaveText(
    `${initialMatch === totalMatches ? 1 : initialMatch + 1}/${totalMatches}`,
  );
  await previousButton.click();
  await expect(searchCount).toHaveText(`${initialMatch}/${totalMatches}`);
});

test('reader сохраняет видимый блок при изменении ширины документа', async ({ page }) => {
  await openReader(page);
  await moveToAnchor(page, 'Глава 20');
  const before = await anchorBounds(page, 'Глава 20');
  expect(before).not.toBeNull();

  await page.mouse.move(10, 10);
  const ruler = page.getByRole('slider', { name: 'Максимальная ширина текста' });
  await expect(ruler).toBeVisible();
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();

  if (!rulerBox) return;
  const centerY = rulerBox.y + rulerBox.height / 2;
  await page.mouse.move(rulerBox.x + rulerBox.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(rulerBox.x + rulerBox.width * 0.78, centerY, { steps: 5 });
  await page.mouse.up();
  await expect(ruler).toHaveAttribute('aria-valuenow', /^(?!960$)/);

  const after = await anchorBounds(page, 'Глава 20');
  expect(after).not.toBeNull();
  expect(after?.bottom).toBeGreaterThan(-250);
  expect(after?.top).toBeLessThan(after?.viewportHeight ?? 0);
});

test('reader сохраняет позицию при изменении шрифта, размера и параметров абзаца', async ({
  page,
}) => {
  await openReader(page);
  await moveToAnchor(page, 'Глава 33');
  const before = await anchorBounds(page, 'Глава 33');
  expect(before).not.toBeNull();
  await openReaderSettings(page);

  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) });
  await panel.locator('select').selectOption('"Lora", "Noto Serif", "Noto Sans", serif');
  await page.waitForTimeout(1000);
  const ranges = panel.locator('input[type="range"]');
  await dragRangeToEnd(page, ranges.nth(0));
  await dragRangeToEnd(page, ranges.nth(1));
  await dragRangeToEnd(page, ranges.nth(2));
  await dragRangeToEnd(page, ranges.nth(3));

  await expect(ranges.nth(0)).toHaveValue('30');
  await expect(ranges.nth(1)).toHaveValue('2.2');
  await expect(ranges.nth(2)).toHaveValue('64');
  await expect(ranges.nth(3)).toHaveValue('36');
  await moveToAnchor(page, 'Глава 33');
  const after = await anchorBounds(page, 'Глава 33');
  expect(after).not.toBeNull();
  expect(after?.bottom).toBeGreaterThan(-250);
  expect(after?.top).toBeLessThan(after?.viewportHeight ?? 0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await openReaderSettings(page);
  await expect(
    page
      .locator('aside')
      .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) })
      .locator('select'),
  ).toHaveValue('"Lora", "Noto Serif", "Noto Sans", serif');
  await expect(
    page
      .locator('aside')
      .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) })
      .locator('input[type=range]')
      .nth(0),
  ).toHaveValue('30');
});

test('reader сохраняет позицию при изменении viewport и восстанавливает её после повторного открытия', async ({
  page,
}) => {
  await openReader(page);
  await moveToAnchor(page, 'Глава 50');
  const beforeResize = await anchorBounds(page, 'Глава 50');
  expect(beforeResize).not.toBeNull();

  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(400);
  const afterResize = await anchorBounds(page, 'Глава 50');
  expect(afterResize).not.toBeNull();
  expect(afterResize?.bottom).toBeGreaterThan(-250);
  expect(afterResize?.top).toBeLessThan(afterResize?.viewportHeight ?? 0);

  const progressResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/books/${readerBookId}/progress`) &&
      response.request().method() === 'PUT',
  );
  await page.mouse.wheel(0, 50_000);
  const savedProgress = await progressResponse;
  expect((await savedProgress.json()).progress_percent).toBeGreaterThan(60);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
});

test('reader открывает и закрывает FB2-сноску, а Escape закрывает её', async ({ page }) => {
  await openReader(page);
  const noteLink = page.locator('main button').filter({ hasText: '[1]' }).first();
  await expect(noteLink).toBeVisible();
  await noteLink.dispatchEvent('click');
  await expect(page.getByRole('dialog', { name: 'Сноска' })).toContainText(
    'Текст тестовой сноски.',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Сноска' })).toBeHidden();
});

test('FB2 reader открывает оглавление, переходит к разделу и сохраняет панель открытой', async ({
  page,
}) => {
  await openReader(page);
  await openReaderToc(page);
  await expect(page.getByRole('button', { name: 'Глава первая' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Глава 50' })).toBeVisible();
  await page.getByRole('button', { name: 'Глава 50' }).click();
  await expect.poll(() => anchorTop(page, 'Глава 50')).not.toBeNull();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
});

test('FB2 reader взаимно исключает панели настроек и оглавления', async ({ page }) => {
  await openReader(page);
  await openReaderSettings(page);
  await openReaderToc(page);
  await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();

  await openReaderSettings(page);
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeVisible();
});

test('FB2 reader закрывает оглавление кнопкой закрытия и повторным нажатием', async ({ page }) => {
  await openReader(page);
  await openReaderToc(page);
  await page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Оглавление' }) })
    .getByRole('button', { name: 'Закрыть' })
    .click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();

  await openReaderToc(page);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();
});

test('FB2 reader не показывает сноски в оглавлении', async ({ page }) => {
  await openReader(page);
  await openReaderToc(page);
  await expect(page.getByRole('button', { name: 'Сноска' })).toHaveCount(0);
});

test('читатель EPUB использует общий интерфейс с оглавлением, поиском и сносками', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'EPUB для проверки' }).click();
  await expect(page.getByRole('heading', { name: 'Глава EPUB' })).toBeVisible();

  await openReaderToc(page);
  await expect(page.getByRole('button', { name: 'Глава EPUB' })).toBeVisible();
  await page.getByRole('button', { name: 'Глава EPUB' }).click();

  await page.mouse.move(10, 10);
  const search = page.getByRole('search');
  await search.getByRole('searchbox').fill('Текст таблицы');
  await search.getByRole('searchbox').press('Enter');
  await expect(search.getByText('1/1')).toBeVisible();

  const noteLink = page.locator('main button').filter({ hasText: '[1]' });
  await noteLink.click();
  await expect(page.getByRole('dialog', { name: 'Сноска' })).toContainText('Текст EPUB-сноски.');
});
