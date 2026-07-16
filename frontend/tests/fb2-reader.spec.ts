import { expect, test } from './fixtures';
import { login } from './support/api';

test('читатель FB2 открывает книгу в браузере', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();

  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
});
