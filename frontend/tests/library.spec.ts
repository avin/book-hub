import { expect, test } from './fixtures';
import { login } from './support/api';

test('авторизованный пользователь видит библиотеку', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('heading', { name: /Ваши книги/ })).toContainText('4');
  await expect(page.getByRole('article')).toHaveCount(4);
});
