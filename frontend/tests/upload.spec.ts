import { expect, test } from './fixtures';
import { login } from './support/api';
import { req, user } from './mocks/auth';

test('область загрузки считает выбранные книги и предупреждает о превышении на один байт', async ({
  page,
  api,
}, testInfo) => {
  await login(page);
  await api.intercept(req.currentUser, { ...user, quota_bytes: 4096, used_bytes: 2048 });
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();

  const dropzone = page.getByRole('button', { name: /Перетащите книги сюда/ });
  const fileInput = page.locator('input[type="file"]').first();
  const warning = page.getByText(/Недостаточно места:/);
  await expect(dropzone).toContainText('Свободное место: 2.0 KB');
  await expect(dropzone).toContainText('Размер выбранных файлов: 0 B');

  await fileInput.setInputFiles({
    name: 'Первая.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'.padEnd(1024, ' ')),
  });
  await fileInput.setInputFiles([
    {
      name: 'Вторая.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'.padEnd(1024, ' ')),
    },
    { name: 'Не книга.txt', mimeType: 'text/plain', buffer: Buffer.alloc(4096) },
  ]);
  const selection = page.getByRole('button', { name: /Выбрано книг:/ });
  await expect(selection).toContainText('Выбрано книг: 2');
  await expect(selection).toContainText('Размер выбранных файлов: 2.0 KB');
  await expect(warning).toHaveCount(0);

  const coverInput = page.locator('input[accept="image/jpeg,image/png,image/webp"]').first();
  await expect(coverInput).toBeEnabled();
  await coverInput.setInputFiles({
    name: 'Обложка.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZYAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await expect(coverInput).toBeEnabled();
  await expect(selection).toContainText('Размер выбранных файлов: 2.0 KB');
  await expect(warning).toHaveCount(0);

  await selection.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['x'], 'Третья.fb2', { type: 'application/xml' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  });
  await expect(selection).toContainText('Выбрано книг: 3');
  await expect(warning).toHaveText(
    'Недостаточно места: освободите ещё 1 B или уберите часть файлов',
  );
  await expect(page.getByRole('button', { name: 'Загрузить книги', exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 375, height: 900 });
  await expect(warning).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('quota-mobile.png') });

  await page.getByRole('button', { name: 'Убрать', exact: true }).last().click();
  await expect(warning).toHaveCount(0);
  await expect(selection).toContainText('Размер выбранных файлов: 2.0 KB');
  await page.getByRole('button', { name: 'Убрать', exact: true }).last().click();
  await expect(selection).toContainText('Размер выбранных файлов: 1.0 KB');
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(dropzone).toContainText('Размер выбранных файлов: 0 B');
  await expect(dropzone).toContainText('Свободное место: 2.0 KB');
});

for (const quotaBytes of [0, 2048]) {
  test(`при исчерпанной квоте ${quotaBytes} показывает ноль свободного места`, async ({
    page,
    api,
  }) => {
    await login(page);
    await api.intercept(req.currentUser, {
      ...user,
      quota_bytes: quotaBytes,
      used_bytes: quotaBytes,
    });
    await page.getByRole('link', { name: 'Загрузить книгу' }).click();
    await expect(page.getByText('Свободное место: 0 B', { exact: true })).toBeVisible();
    await expect(page.getByText(/Недостаточно места:/)).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'Книга.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    });
    await expect(page.getByText(/Недостаточно места:/)).toHaveText(
      'Недостаточно места: освободите ещё 14 B или уберите часть файлов',
    );
  });
}

test('при ошибке обновления квоты показывает недоступность данных и размер выбранных файлов', async ({
  page,
  api,
}) => {
  await login(page);
  await api.intercept(req.currentUser, { code: 'service_unavailable' }, 503);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await expect(page.getByText('Не удалось узнать свободное место')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Книга.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  await expect(page.getByText('Размер выбранных файлов: 14 B')).toBeVisible();
  await expect(page.getByText(/Недостаточно места:/)).toHaveCount(0);
});

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
  api,
}) => {
  await login(page);
  let usedBytes = 0;
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...user, quota_bytes: 40, used_bytes: usedBytes }),
    }),
  );
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await expect(page.getByText('Свободное место: 40 B', { exact: true })).toBeVisible();

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

    if (uploadAttempts > 2) {
      await route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'quota_exceeded', message: 'Квота закончилась' }),
      });
      return;
    }

    usedBytes += 14;
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
  await expect(page.getByText('Свободное место: 26 B', { exact: true })).toBeVisible();
  await expect(page.getByText('Размер выбранных файлов: 14 B')).toBeVisible();

  await api.intercept(req.currentUser, { ...user, quota_bytes: 40, used_bytes: 35 });
  await page.getByRole('button', { name: 'Загрузить книги', exact: true }).click();
  await expect(page.getByText('Свободное место: 5 B', { exact: true })).toBeVisible();
  await expect(page.getByText(/Недостаточно места:/)).toHaveText(
    'Недостаточно места: освободите ещё 9 B или уберите часть файлов',
  );
});
