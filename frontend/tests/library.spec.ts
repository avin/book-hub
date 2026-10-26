import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';

test('описание сворачивается до двух строк и раскрывается кнопкой', async ({ page, api }) => {
  const description = 'Длинное описание книги с подробностями и примерами. '.repeat(40);
  await api.intercept(books.req.list, {
    items: [
      { ...books.items[0], description },
      { ...books.items[1], description: 'Короткое описание.' },
      { ...books.items[2], description: 'Первая строка\nВторая строка' },
    ],
    total: 3,
    limit: 24,
    offset: 0,
  });
  await login(page);

  const card = page.getByRole('article').first();
  const expand = card.getByRole('button', { name: 'Развернуть', exact: true });
  const paragraph = card.locator('p').filter({
    has: page.getByRole('button', { name: 'Развернуть', exact: true }),
  });
  await expect(expand).toBeVisible();
  await expect(expand.locator('svg')).toBeVisible();
  expect(await paragraph.evaluate((element) => element.firstChild?.textContent)).not.toContain('…');
  await expect.poll(() => paragraph.evaluate((element) => element.clientHeight)).toBe(40);
  await expect(page.getByRole('button', { name: 'Развернуть', exact: true })).toHaveCount(1);
  await card.screenshot({ path: test.info().outputPath('collapsed-description.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => paragraph.evaluate((element) => element.clientHeight)).toBe(40);
  const buttonLine = await expand.evaluate((button) => {
    const paragraph = button.parentElement!;
    return button.getBoundingClientRect().bottom - paragraph.getBoundingClientRect().top;
  });
  expect(buttonLine).toBeGreaterThan(20);
  expect(buttonLine).toBeLessThanOrEqual(40);
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(expand).toHaveCount(0);
  const fullText = card.locator('p:not([aria-hidden])');
  await expect(fullText).toHaveText(description.trim());
  expect(await fullText.evaluate((element) => element.clientHeight)).toBeGreaterThan(40);
  await expect(page).toHaveURL(/\/library/);
});

test('редактор сразу подстраивает высоту описания и сохраняет его без потери переносов', async ({
  page,
  api,
}) => {
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], description: 'Раз\nДва\nТри' }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await login(page);
  await page.getByRole('button', { name: 'Действия с книгой' }).click();
  await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить книгу' });
  const description = dialog.getByRole('textbox', { name: 'Описание', exact: true });
  await expect(description).toHaveValue('Раз\nДва\nТри');
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(80);
  await page.screenshot({ path: test.info().outputPath('description-editor.png') });
  await description.fill('  Новый текст\n\nВторой абзац  ');
  await description.press('End');
  await description.press('Enter');
  await expect(dialog).toBeVisible();
  const saved = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/v1/books/'),
  );
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    description: 'Новый текст\n\nВторой абзац',
  });
  await expect(dialog).toBeHidden();
});

test('авторизованный пользователь видит библиотеку', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('heading', { name: /Ваши книги/ })).toContainText('4');
  await expect(page.getByRole('article')).toHaveCount(4);
});
