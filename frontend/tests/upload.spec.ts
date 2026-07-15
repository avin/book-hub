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

test('частичная batch-загрузка оставляет неудачный черновик и обрабатывает следующие книги', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();

  let uploadAttempts = 0;
  await page.route('**/api/v1/books', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    uploadAttempts += 1;
    if (uploadAttempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Первая загрузка не удалась' }),
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-0000-0000-000000000199',
        title: 'Успешная книга',
        tags: [],
        favorite: false,
        format: 'fb2',
        size_bytes: 1,
        progress_percent: 0,
        created_at: '2026-01-01T00:00:00Z',
        last_opened_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    });
  });

  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'Неудачная.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    },
    {
      name: 'Успешная.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    },
  ]);
  await page.locator('input[type="text"]').nth(0).fill('Неудачная книга');
  await page.locator('input[type="text"]').nth(1).fill('Успешная книга');
  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByText('Первая загрузка не удалась')).toBeVisible();
  await expect(page.locator('input[type="text"]')).toHaveCount(1);
  expect(uploadAttempts).toBe(2);
});
