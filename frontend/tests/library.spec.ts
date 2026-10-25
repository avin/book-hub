import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';

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
