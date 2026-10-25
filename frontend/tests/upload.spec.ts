import { expect, test } from './fixtures';
import { login } from './support/api';

test('описание растёт до десяти видимых строк и уменьшается при удалении', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Книга.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  const description = page.getByRole('textbox', { name: 'Описание', exact: true });
  await expect(description).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('textbox', { name: 'Название', exact: true })
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(40);
  expect(await description.evaluate((element) => element.getBoundingClientRect().height)).toBe(40);
  await description.fill('Раз\nДва\nТри');
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(80);
  await description.fill(Array.from({ length: 12 }, (_, index) => `Строка ${index}`).join('\n'));
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(220);
  expect(await description.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  await description.fill('Одна строка');
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(40);
  expect(await description.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
    'hidden',
  );
  await description.press('End');
  await description.press('Enter');
  await expect(description).toHaveValue('Одна строка\n');
  await expect(page).toHaveURL(/\/upload$/);
  await description.fill('Описание книги с переносом по ширине. '.repeat(8));
  const wideHeight = await description.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page.setViewportSize({ width: 375, height: 900 });
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(wideHeight);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(wideHeight);
  await description.fill('я'.repeat(9999));
  await description.press('End');
  await page.keyboard.insertText('🙂');
  await expect(description).toHaveValue('я'.repeat(9999));
  await page.keyboard.insertText('а');
  await expect(description).toHaveValue('я'.repeat(9999) + 'а');
  await page.keyboard.insertText('б');
  await expect(description).toHaveValue('я'.repeat(9999) + 'а');
});

test('загрузка книги передаёт multipart-запрос и возвращает в библиотеку', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Новая книга.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Тестовая книга');
  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/library$/);
});

test('частичная batch-загрузка оставляет неудачный черновик и обрабатывает следующие книги', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();

  let uploadAttempts = 0;
  const submittedDescriptions: string[] = [];
  await page.route('**/api/v1/books', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    uploadAttempts += 1;
    submittedDescriptions.push(route.request().postDataBuffer()?.toString('utf8') ?? '');
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
  await page.getByRole('textbox', { name: 'Название', exact: true }).nth(0).fill('Неудачная книга');
  await page.getByRole('textbox', { name: 'Название', exact: true }).nth(1).fill('Успешная книга');
  await page
    .getByRole('textbox', { name: 'Описание', exact: true })
    .nth(0)
    .fill('Описание первой книги');
  await page
    .getByRole('textbox', { name: 'Описание', exact: true })
    .nth(1)
    .fill('Описание второй книги');
  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByText('Первая загрузка не удалась')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toHaveCount(1);
  expect(uploadAttempts).toBe(2);
  await expect(page.getByRole('textbox', { name: 'Описание', exact: true })).toHaveValue(
    'Описание первой книги',
  );
  expect(submittedDescriptions[0]).toContain('Описание первой книги');
  expect(submittedDescriptions[1]).toContain('Описание второй книги');
});
