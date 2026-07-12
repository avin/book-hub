import { expect, test } from './fixtures';
import { login } from './support/api';

test('настройки меняют тему, валидируют пароль и сбрасывают прогресс', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: /Настройки аккаунта/ })).toBeVisible();
  await page.getByRole('radio', { name: 'Малахит' }).click();

  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Заполните поле')).toBeVisible();
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill('old');
  await passwordFields.nth(1).fill('new');
  await passwordFields.nth(2).fill('different');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Пароли не совпадают')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click();
  await expect(page.getByText('Прогресс сброшен')).toBeVisible();
});
