import { expect, test } from './fixtures';
import { login } from './support/api';

test('читатель PDF отрисовывает страницу в браузере', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();

  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
});
