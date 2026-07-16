import { expect, test } from './fixtures';

test('гость может зарегистрироваться', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Регистрация' }).click();
  await page.locator('#login').fill('new-reader');
  await page.locator('#password').fill('secret');
  await page.locator('#repeat-password').fill('secret');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page.getByRole('status')).toHaveText(
    'Заявка создана. Дождитесь активации аккаунта.',
  );
});
