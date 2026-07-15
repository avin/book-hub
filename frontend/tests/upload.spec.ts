import { expect, test } from './fixtures';
import { login } from './support/api';

test('загрузка книги передаёт multipart-запрос и возвращает в библиотеку', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Новая книга.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  await page.locator('input[type="text"]').fill('Тестовая книга');
  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/library$/);
});
