import { expect, test } from './fixtures';
import { user, req } from './mocks/auth';

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

test('временная недоступность проверки сессии сохраняет маршрут и позволяет повторить запрос', async ({
  page,
  api,
}) => {
  await api.intercept(
    req.currentUser,
    {
      code: 'service_unavailable',
      message: 'storage temporarily unavailable',
      request_id: 'test',
    },
    503,
  );
  await page.goto('/library');

  await expect(page.getByRole('alert')).toHaveText(
    'Сервер временно недоступен. Попробуйте ещё раз.Повторить',
  );
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator('#login')).toHaveCount(0);

  await api.intercept(req.currentUser, user);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
});
