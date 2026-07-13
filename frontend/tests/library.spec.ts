import { expect, test } from './fixtures';
import { login } from './support/api';

test('библиотека поддерживает поиск, фильтры, вид и действия книги', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: /Ваши книги/ })).toContainText('4');
  await expect(page.getByRole('article')).toHaveCount(4);

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
  const downloadItem = page.getByRole('menuitem', { name: 'Скачать книгу' });
  await expect(downloadItem).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), downloadItem.click()]);
  expect(download.url()).toContain('/file?download=1');

  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Удалить' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
});
