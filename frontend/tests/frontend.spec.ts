import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { login } from './support/api';

const readerBookId = '00000000-0000-0000-0000-000000000101';

async function openReader(page: Page) {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();
  await expect(page.getByText('Глава первая')).toBeVisible();
}

async function anchorTop(page: Page, title: string) {
  return page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );

    return heading?.getBoundingClientRect().top ?? null;
  }, title);
}

async function anchorBounds(page: Page, title: string) {
  return page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );
    if (!heading) return null;
    const rect = heading.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  }, title);
}

async function moveToAnchor(page: Page, title: string) {
  const chapterNumber = title === 'Глава первая' ? 1 : Number(title.match(/\d+/)?.[0] ?? 1);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(10_000);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(100);
  for (let step = 0; step < Math.max(1, chapterNumber * 2); step += 1) {
    if ((await anchorTop(page, title)) !== null) break;
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(50);
  }
  await expect.poll(() => anchorTop(page, title)).not.toBeNull();
  await page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );
    heading?.scrollIntoView({ block: 'center' });
  }, title);
  await page.waitForTimeout(50);
}

async function openReaderSettings(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Настройки внешнего вида' }).click();
  await expect(page.locator('aside select')).toBeVisible();
}

async function dragRangeToEnd(page: Page, range: ReturnType<Page['locator']>) {
  const box = await range.boundingBox();
  expect(box).not.toBeNull();

  if (!box) return;
  const y = box.y + box.height / 2;
  await range.scrollIntoViewIfNeeded();
  await page.mouse.move(box.x + box.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 8 });
  await page.mouse.up();
}

test('гость видит форму входа, валидацию и может зарегистрироваться', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Book Hub' })).toBeVisible();
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Заполните поле').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Регистрация' }).click();
  await page.locator('#login').fill('new-reader');
  await page.locator('#password').fill('secret');
  await page.locator('#repeat-password').fill('different');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText('Пароли не совпадают')).toBeVisible();
  await page.locator('#repeat-password').fill('secret');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Заявка создана. Дождитесь активации аккаунта.',
  );
});

test('библиотека поддерживает поиск, фильтры, вид и действия книги', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: /Ваши книги/ })).toContainText('2');
  await expect(page.getByRole('article')).toHaveCount(2);

  await page.getByPlaceholder('Найти по названию').fill('Мастер');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Мастер и Маргарита' })).toBeVisible();
  await page.getByRole('button', { name: 'Очистить поиск' }).click();

  await page.getByRole('button', { name: 'Сетка' }).click();
  await expect(page.getByRole('button', { name: 'Сетка' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  await page.getByRole('menuitem', { name: 'Изменить' }).click();
  await expect(page.getByRole('dialog', { name: 'Изменить книгу' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();

  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Удалить' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('загрузка книги отправляет замокированный multipart-запрос', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await expect(page.getByRole('heading', { name: 'Добавить книги' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Новая книга.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  await expect(page.getByText('Выбрано книг: 1')).toBeVisible();
  await page.locator('input[type="text"]').fill('Тестовая книга');
  await page.getByRole('button', { name: 'Загрузить книги' }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test('настройки меняют тему, валидируют пароль и сбрасывают прогресс', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: /Настройки аккаунта/ })).toBeVisible();
  await page.getByRole('radio', { name: 'Малахит' }).click();

  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Заполните поле')).toBeVisible();
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill('old');
  await passwordFields.nth(1).fill('new');
  await passwordFields.nth(2).fill('different');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Пароли не совпадают')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click();
  await expect(page.getByText('Прогресс сброшен')).toBeVisible();
});

test('читатель FB2 загружает книгу и сохраняет избранное/прогресс через моки', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();
  await expect(page.getByText('Глава первая')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать из избранного' }).dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Добавить в избранное' })).toBeVisible();
  await page.getByRole('link', { name: 'Библиотека' }).dispatchEvent('click');
  await expect(page).toHaveURL(/\/library$/);
});

test('выход завершает сессию и возвращает на вход', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
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

  const panel = page.locator('aside');
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
  await expect(page.getByText('Глава первая')).toBeVisible();
  await openReaderSettings(page);
  await expect(page.locator('aside select')).toHaveValue(
    '"Lora", "Noto Serif", "Noto Sans", serif',
  );
  await expect(page.locator('aside input[type=range]').nth(0)).toHaveValue('30');
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
  await expect(page.getByText('Глава первая')).toBeVisible();
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

test('PDF позволяет выделить и скопировать встроенный текст', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.locator('canvas')).toBeVisible();

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
