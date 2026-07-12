import { expect, test } from './fixtures';
import * as auth from './mocks/auth';
import { login } from './support/api';

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

test('показывает неактивированную учётную запись после успешной проверки пароля', async ({
  page,
  api,
}) => {
  await api.intercept(
    auth.req.login,
    {
      code: 'account_inactive',
      message: 'account is inactive',
      request_id: 'request-id',
    },
    403,
  );

  await page.goto('/login');
  await page.locator('#login').fill('reader');
  await page.locator('#password').fill('secret');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByRole('alert')).toHaveText('Данная учётная запись ещё не активирована.');
});

test('выход завершает сессию и возвращает на вход', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});
