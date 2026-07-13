import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

test('загрузка книги отправляет замокированный multipart-запрос', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await expect(page.getByRole('heading', { name: 'Добавить книги' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Новая книга.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  await expect(page.getByText('Выбрано книг: 1')).toBeVisible();
  await page.locator('input[type="text"]').fill('Тестовая книга');
  await page.getByRole('button', { name: 'Загрузить книги' }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test('загрузка принимает проверенный EPUB и блокирует повреждённый архив', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  const input = page.locator('input[type="file"]');

  await input.setInputFiles({
    name: 'Проверенная книга.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(bookMocks.epubFile),
  });
  await expect(page.locator('img').first()).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить книги' }).click();
  await expect(page).toHaveURL(/\/library$/);

  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await input.setInputFiles({
    name: 'Повреждённая книга.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('not an epub archive'),
  });
  await expect(page.getByText('Некорректный EPUB нельзя загрузить').first()).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить книги' }).click();
  await expect(page.getByText('Некорректный EPUB нельзя загрузить').last()).toBeVisible();
  await expect(page).toHaveURL(/\/upload$/);
});

test('частичная ошибка загрузки оставляет только неудачный черновик', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();

  let uploadCount = 0;
  await page.route('**/api/v1/books', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    uploadCount += 1;
    if (uploadCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Не удалось сохранить книгу' }),
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...bookMocks.items[0], id: '00000000-0000-0000-0000-000000000199' }),
    });
  });

  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'Неудачная книга.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    },
    {
      name: 'Успешная книга.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    },
  ]);

  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Не удалось сохранить книгу')).toBeVisible();
  await expect(
    page.getByText('Некоторые книги не удалось загрузить. Проверьте ошибки в списке.'),
  ).toHaveCount(0);
});

test('загрузка блокирует навигацию до завершения batch', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();

  let markUploadStarted: () => void = () => undefined;
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  let releaseUpload: () => void = () => undefined;
  const uploadCanFinish = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });

  await page.route('**/api/v1/books', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    markUploadStarted();
    await uploadCanFinish;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...bookMocks.items[0], id: '00000000-0000-0000-0000-000000000199' }),
    });
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'Долгая загрузка.fb2',
    mimeType: 'application/xml',
    buffer: Buffer.from('<FictionBook/>'),
  });
  await page.getByRole('button', { name: 'Загрузить книги' }).click();
  await uploadStarted;

  try {
    await expect(
      page.getByRole('link', { name: 'Библиотека' }).click({ timeout: 500 }),
    ).rejects.toThrow();
  } finally {
    releaseUpload();
  }

  await expect(page).toHaveURL(/\/library$/);
});

test('извлечение обложки не блокирует начало загрузки', async ({ page }) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (this instanceof File && this.name === 'Долгая подготовка.pdf') {
        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            void originalArrayBuffer.call(this).then(resolve, reject);
          }, 1_000);
        });
      }

      return originalArrayBuffer.call(this);
    };
  });

  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Долгая подготовка.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bookMocks.pdfFile),
  });

  await expect(page.getByText('Извлекаем обложку')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить книги' })).toBeEnabled({ timeout: 300 });
});

test('извлечение обложки блокирует ручной выбор обложки', async ({ page }) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (this instanceof File && this.name === 'Долгая подготовка.pdf') {
        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            void originalArrayBuffer.call(this).then(resolve, reject);
          }, 1_000);
        });
      }

      return originalArrayBuffer.call(this);
    };
  });

  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Долгая подготовка.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bookMocks.pdfFile),
  });

  await expect(page.getByText('Извлекаем обложку')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить обложку' })).toBeDisabled({
    timeout: 300,
  });
});

test('ошибка загрузки обложки не отменяет успешную загрузку книги', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.route('**/api/v1/books/*/cover', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Не удалось сохранить обложку' }),
    });
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'Книга с обложкой.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bookMocks.pdfFile),
  });
  await expect(page.getByRole('article').locator('img')).toBeVisible();

  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/library$/);
});

test('ошибка подготовки одной книги не мешает загрузить остальные', async ({ page }) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (this instanceof File && this.name === 'Сломанная обложка.pdf') {
        return Promise.reject(null);
      }

      return originalArrayBuffer.call(this);
    };
  });

  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'Сломанная обложка.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bookMocks.pdfFile),
    },
    {
      name: 'Успешная книга.fb2',
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    },
  ]);

  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByText('Не удалось извлечь обложку')).toBeVisible();
  await expect(page.getByText('Обложка не найдена')).toBeVisible();

  await page.getByRole('button', { name: 'Загрузить книги' }).click();

  await expect(page).toHaveURL(/\/library$/);
});

test('удаление черновика во время подготовки обложки не оставляет следов', async ({ page }) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (this instanceof File && this.name === 'Долгая подготовка.pdf') {
        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            void originalArrayBuffer.call(this).then(resolve, reject);
          }, 1_000);
        });
      }

      return originalArrayBuffer.call(this);
    };
  });

  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Долгая подготовка.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bookMocks.pdfFile),
  });

  await expect(page.getByText('Извлекаем обложку')).toBeVisible();
  await page.getByRole('button', { name: 'Убрать' }).click();

  await expect(page.getByRole('article')).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Извлекаем обложку')).toHaveCount(0);
});
