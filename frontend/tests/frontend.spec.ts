import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

const readerBookId = '00000000-0000-0000-0000-000000000101';

async function openReader(page: Page) {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
}

async function anchorTop(page: Page, title: string) {
  return page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );

    return heading?.getBoundingClientRect().top ?? null;
  }, title);
}

async function anchorBounds(page: Page, title: string) {
  return page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );
    if (!heading) return null;
    const rect = heading.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  }, title);
}

async function moveToAnchor(page: Page, title: string) {
  const chapterNumber = title === 'Глава первая' ? 1 : Number(title.match(/\d+/)?.[0] ?? 1);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(10_000);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(100);
  for (let step = 0; step < Math.max(1, chapterNumber * 2); step += 1) {
    if ((await anchorTop(page, title)) !== null) break;
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(50);
  }
  await expect.poll(() => anchorTop(page, title)).not.toBeNull();
  await page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );
    heading?.scrollIntoView({ block: 'center' });
  }, title);
  await page.waitForTimeout(50);
}

async function openReaderSettings(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Настройки внешнего вида' }).click();
  await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeVisible();
}

async function openReaderToc(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
}

async function dragRangeToEnd(page: Page, range: ReturnType<Page['locator']>) {
  await range.scrollIntoViewIfNeeded();
  const box = await range.boundingBox();
  expect(box).not.toBeNull();

  if (!box) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 8 });
  await page.mouse.up();
}

const pdfOutlineBookId = '00000000-0000-0000-0000-000000000103';

async function openPdfFiltersPanel(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  return page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
}

async function pdfAppliedFilterKey(page: Page, pageNumber = '1') {
  return page.locator(`[data-page-number="${pageNumber}"]`).getAttribute('data-applied-filter-key');
}

function parsePdfFilterChain(key: string | null) {
  if (!key) {
    return undefined;
  }

  return JSON.parse(key) as Array<{ id: string; enabled: boolean; [key: string]: unknown }>;
}

async function isWebglAvailable(page: Page) {
  return page.evaluate(() => document.createElement('canvas').getContext('webgl') !== null);
}

async function reorderPdfFilter(
  page: Page,
  sourceId: 'textEnhancement' | 'invert',
  targetId: 'textEnhancement' | 'invert',
) {
  await page.evaluate(
    async ({ source, target }) => {
      const handle = document.querySelector(`[data-testid="pdf-filter-drag-handle-${source}"]`);
      const targetElement = document.querySelector(`[data-testid="pdf-filter-item-${target}"]`);

      if (!handle || !targetElement) {
        throw new Error(`Missing drag source or target for ${source} -> ${target}`);
      }

      const handleRect = handle.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const sourceX = handleRect.left + handleRect.width / 2;
      const sourceY = handleRect.top + handleRect.height / 2;
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + 8;
      const mouseEvent = (type: string, x: number, y: number, buttons: number) =>
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        });

      handle.dispatchEvent(mouseEvent('mousedown', sourceX, sourceY, 1));
      await new Promise((resolve) => window.setTimeout(resolve));
      targetElement.dispatchEvent(mouseEvent('mousemove', targetX, targetY, 1));
      await new Promise((resolve) => window.setTimeout(resolve));
      document.dispatchEvent(mouseEvent('mouseup', targetX, targetY, 0));
    },
    { source: sourceId, target: targetId },
  );
}

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

test('библиотека поддерживает поиск, фильтры, вид и действия книги', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: /Ваши книги/ })).toContainText('3');
  await expect(page.getByRole('article')).toHaveCount(3);

  await page.getByPlaceholder('Найти по названию').fill('Мастер');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Мастер и Маргарита' })).toBeVisible();
  await page.getByRole('button', { name: 'Очистить поиск' }).click();

  await page.getByRole('button', { name: 'Сетка' }).click();
  await expect(page.getByRole('button', { name: 'Сетка' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  await page.getByRole('menuitem', { name: 'Изменить' }).click();
  await expect(page.getByRole('dialog', { name: 'Изменить книгу' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();

  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  const downloadItem = page.getByRole('menuitem', { name: 'Скачать книгу' });
  await expect(downloadItem).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), downloadItem.click()]);
  expect(download.url()).toContain('/file?download=1');

  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Удалить' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});

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

test('читатель FB2 загружает книгу и сохраняет избранное/прогресс через моки', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать из избранного' }).dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Добавить в избранное' })).toBeVisible();
  await page.getByRole('link', { name: 'Библиотека' }).dispatchEvent('click');
  await expect(page).toHaveURL(/\/library$/);
});

test('общий reader chrome открывается с клавиатуры и закрывается с сохранением запроса', async ({
  page,
}) => {
  await openReader(page);

  const searchInput = page.getByRole('search').getByRole('searchbox');

  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await expect(searchInput).toBeFocused();
  await expect(page.getByRole('search').getByText('0/0')).toBeVisible();
  await searchInput.fill('сохранённый запрос');
  await searchInput.blur();
  await searchInput.focus();
  await page.keyboard.type('новый запрос');
  await expect(searchInput).toHaveValue('новый запрос');
  await searchInput.press('Escape');

  const document = page.locator('main');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');
  await document.dispatchEvent('pointerup', { pointerType: 'touch', clientY: 300 });
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');

  await page.mouse.move(10, 10);
  await expect(searchInput).toHaveValue('новый запрос');
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
});

test('PDF reader использует те же правила открытия и закрытия chrome', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();

  const document = page.locator('[data-page-number="1"]');
  const searchInput = page.getByRole('search').getByRole('searchbox');

  await expect(document.locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');

  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'false');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');

  await page.keyboard.press('Control+f');
  await expect(searchInput).toBeFocused();
  await expect(page.getByTestId('reader-floating-header')).toHaveAttribute('data-visible', 'true');

  await searchInput.press('Escape');
  await document.dispatchEvent('pointerup', { pointerType: 'touch', clientY: 300 });
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'true');
  await document.dispatchEvent('click');
  await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute('data-visible', 'false');
});

test('поиск FB2 запускается явно, подсвечивает сноски и циклически навигируется', async ({
  page,
}) => {
  await openReader(page);

  await page.mouse.move(10, 10);
  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  const nextButton = search.getByRole('button', { name: 'Найти следующее' });
  const previousButton = search.getByRole('button', { name: 'Найти предыдущее' });

  await expect(search.getByText('0/0')).toBeVisible();
  await searchInput.fill('  тестовой   сноски  ');
  await expect(search.getByText('0/0')).toBeVisible();
  await expect(page.locator('mark[data-search-match]')).toHaveCount(0);

  await searchInput.press('Enter');
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(page.locator('mark[data-search-match]').first()).toBeVisible();
  await expect(page.locator('mark[data-search-match][data-search-active="true"]')).toHaveCount(1);

  const progressResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/books/${readerBookId}/progress`) &&
      response.request().method() === 'PUT',
  );
  await nextButton.click();
  await progressResponse;
  await expect(search.getByText('1/1')).toBeVisible();

  await previousButton.click();
  await expect(search.getByText('1/1')).toBeVisible();

  await searchInput.press('Escape');
  await expect(page.locator('mark[data-search-match]')).toHaveCount(0);
  await page.mouse.move(10, 10);
  await expect(searchInput).toHaveValue('  тестовой   сноски  ');

  await searchInput.press('Enter');
  await expect(search.getByText('1/1')).toBeVisible();
  await expect(page.locator('mark[data-search-match]').first()).toBeVisible();

  await searchInput.fill('Глава');
  await expect(search.getByText('1/1')).toBeVisible();
  await searchInput.press('Enter');
  const searchCount = search.locator('[aria-live="polite"]');
  await expect(searchCount).toHaveText(/\d+\/\d+/);
  const [initialMatch, totalMatches] = ((await searchCount.textContent()) ?? '')
    .split('/')
    .map(Number);
  expect(initialMatch).toBeGreaterThan(0);
  expect(totalMatches).toBeGreaterThan(1);
  await nextButton.click();
  await expect(searchCount).toHaveText(
    `${initialMatch === totalMatches ? 1 : initialMatch + 1}/${totalMatches}`,
  );
  await previousButton.click();
  await expect(searchCount).toHaveText(`${initialMatch}/${totalMatches}`);
});

test('выход завершает сессию и возвращает на вход', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});

test('reader сохраняет видимый блок при изменении ширины документа', async ({ page }) => {
  await openReader(page);
  await moveToAnchor(page, 'Глава 20');
  const before = await anchorBounds(page, 'Глава 20');
  expect(before).not.toBeNull();

  await page.mouse.move(10, 10);
  const ruler = page.getByRole('slider', { name: 'Максимальная ширина текста' });
  await expect(ruler).toBeVisible();
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();

  if (!rulerBox) return;
  const centerY = rulerBox.y + rulerBox.height / 2;
  await page.mouse.move(rulerBox.x + rulerBox.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(rulerBox.x + rulerBox.width * 0.78, centerY, { steps: 5 });
  await page.mouse.up();
  await expect(ruler).toHaveAttribute('aria-valuenow', /^(?!960$)/);

  const after = await anchorBounds(page, 'Глава 20');
  expect(after).not.toBeNull();
  expect(after?.bottom).toBeGreaterThan(-250);
  expect(after?.top).toBeLessThan(after?.viewportHeight ?? 0);
});

test('reader сохраняет позицию при изменении шрифта, размера и параметров абзаца', async ({
  page,
}) => {
  await openReader(page);
  await moveToAnchor(page, 'Глава 33');
  const before = await anchorBounds(page, 'Глава 33');
  expect(before).not.toBeNull();
  await openReaderSettings(page);

  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) });
  await panel.locator('select').selectOption('"Lora", "Noto Serif", "Noto Sans", serif');
  await page.waitForTimeout(1000);
  const ranges = panel.locator('input[type="range"]');
  await dragRangeToEnd(page, ranges.nth(0));
  await dragRangeToEnd(page, ranges.nth(1));
  await dragRangeToEnd(page, ranges.nth(2));
  await dragRangeToEnd(page, ranges.nth(3));

  await expect(ranges.nth(0)).toHaveValue('30');
  await expect(ranges.nth(1)).toHaveValue('2.2');
  await expect(ranges.nth(2)).toHaveValue('64');
  await expect(ranges.nth(3)).toHaveValue('36');
  await moveToAnchor(page, 'Глава 33');
  const after = await anchorBounds(page, 'Глава 33');
  expect(after).not.toBeNull();
  expect(after?.bottom).toBeGreaterThan(-250);
  expect(after?.top).toBeLessThan(after?.viewportHeight ?? 0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await openReaderSettings(page);
  await expect(
    page
      .locator('aside')
      .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) })
      .locator('select'),
  ).toHaveValue('"Lora", "Noto Serif", "Noto Sans", serif');
  await expect(
    page
      .locator('aside')
      .filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) })
      .locator('input[type=range]')
      .nth(0),
  ).toHaveValue('30');
});

test('reader сохраняет позицию при изменении viewport и восстанавливает её после повторного открытия', async ({
  page,
}) => {
  await openReader(page);
  await moveToAnchor(page, 'Глава 50');
  const beforeResize = await anchorBounds(page, 'Глава 50');
  expect(beforeResize).not.toBeNull();

  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(400);
  const afterResize = await anchorBounds(page, 'Глава 50');
  expect(afterResize).not.toBeNull();
  expect(afterResize?.bottom).toBeGreaterThan(-250);
  expect(afterResize?.top).toBeLessThan(afterResize?.viewportHeight ?? 0);

  const progressResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/books/${readerBookId}/progress`) &&
      response.request().method() === 'PUT',
  );
  await page.mouse.wheel(0, 50_000);
  const savedProgress = await progressResponse;
  expect((await savedProgress.json()).progress_percent).toBeGreaterThan(60);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
});

test('reader открывает и закрывает FB2-сноску, а Escape закрывает её', async ({ page }) => {
  await openReader(page);
  const noteLink = page.locator('main button').filter({ hasText: '[1]' }).first();
  await expect(noteLink).toBeVisible();
  await noteLink.dispatchEvent('click');
  await expect(page.getByRole('dialog', { name: 'Сноска' })).toContainText(
    'Текст тестовой сноски.',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Сноска' })).toBeHidden();
});

test('FB2 reader открывает оглавление, переходит к разделу и сохраняет панель открытой', async ({
  page,
}) => {
  await openReader(page);
  await openReaderToc(page);
  await expect(page.getByRole('button', { name: 'Глава первая' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Глава 50' })).toBeVisible();
  await page.getByRole('button', { name: 'Глава 50' }).click();
  await expect.poll(() => anchorTop(page, 'Глава 50')).not.toBeNull();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
});

test('FB2 reader взаимно исключает панели настроек и оглавления', async ({ page }) => {
  await openReader(page);
  await openReaderSettings(page);
  await openReaderToc(page);
  await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();

  await openReaderSettings(page);
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeVisible();
});

test('FB2 reader закрывает оглавление кнопкой закрытия и повторным нажатием', async ({ page }) => {
  await openReader(page);
  await openReaderToc(page);
  await page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Оглавление' }) })
    .getByRole('button', { name: 'Закрыть' })
    .click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();

  await openReaderToc(page);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();
});

test('FB2 reader не показывает сноски в оглавлении', async ({ page }) => {
  await openReader(page);
  await openReaderToc(page);
  await expect(page.getByRole('button', { name: 'Сноска' })).toHaveCount(0);
});

test('PDF reader отключает оглавление без document outline', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);
  const tocButton = page.getByRole('button', { name: 'Оглавление недоступно' });
  await expect(tocButton).toBeDisabled();
});

test('PDF reader открывает панель фильтров и показывает параметры инверсии', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.mouse.move(10, 10);

  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();

  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });
  const strength = panel.getByRole('slider', { name: 'Сила' });

  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(invert).not.toBeChecked();
  await expect(strength).toBeHidden();

  await invert.check();
  await expect
    .poll(async () => {
      if (
        await panel
          .getByRole('alert')
          .isVisible()
          .catch(() => false)
      )
        return 'unavailable';
      if (await strength.isVisible().catch(() => false)) return 'available';
      return 'pending';
    })
    .toMatch(/available|unavailable/);

  if (await strength.isVisible()) {
    await expect(strength).toHaveValue('1');
    await expect.poll(() => pdfAppliedFilterKey(page)).toMatch(/"id":"invert","enabled":true/);
    await invert.uncheck();
    await expect(strength).toBeHidden();
    await expect.poll(() => pdfAppliedFilterKey(page)).toBe('');
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
    await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  }
});

test('PDF reader настраивает усиление текста, применяет его после ползунка и сбрасывает цепочку', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const panel = await openPdfFiltersPanel(page);
  const enhancement = panel.getByRole('checkbox', { name: 'Усиление текста' });
  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });
  const parameterNames = ['Толщина штриха', 'Порог', 'Контраст', 'Уровни серого', 'Сдвиг тона'];

  await expect(enhancement).not.toBeChecked();
  for (const name of parameterNames) {
    await expect(panel.getByRole('slider', { name })).toBeHidden();
  }

  await enhancement.check();
  const webglAvailable = await isWebglAvailable(page);

  if (webglAvailable) {
    await expect(panel.getByRole('slider', { name: 'Толщина штриха' })).toBeVisible();
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }

  if (await panel.getByRole('slider', { name: 'Толщина штриха' }).isVisible()) {
    await expect(panel.getByRole('slider', { name: 'Толщина штриха' })).toHaveValue('0.7');
    await expect(panel.getByRole('slider', { name: 'Порог' })).toHaveValue('0.62');
    await expect(panel.getByRole('slider', { name: 'Контраст' })).toHaveValue('1.85');
    await expect(panel.getByRole('slider', { name: 'Уровни серого' })).toHaveValue('8');
    await expect(panel.getByRole('slider', { name: 'Сдвиг тона' })).toHaveValue('-0.65');

    await dragRangeToEnd(page, panel.getByRole('slider', { name: 'Порог' }));
    await expect(panel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
    await expect
      .poll(async () => {
        const chain = parsePdfFilterChain(await pdfAppliedFilterKey(page));
        return chain?.find((filter) => filter.id === 'textEnhancement')?.threshold;
      })
      .not.toBe(0.62);

    await invert.check();
    await expect.poll(() => pdfAppliedFilterKey(page)).toMatch(/"id":"invert","enabled":true/);

    const searchInput = page.getByRole('search').getByRole('searchbox');
    await searchInput.fill('Page');
    await searchInput.press('Enter');
    await expect(page.getByTestId('pdf-text-layer').locator('.highlight')).toHaveCount(2);

    await reorderPdfFilter(page, 'invert', 'textEnhancement');
    await expect(panel.locator('[data-testid^="pdf-filter-item-"]').nth(0)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-invert',
    );

    await panel.getByRole('button', { name: 'Сбросить все' }).click();
    await expect(enhancement).not.toBeChecked();
    await expect(invert).not.toBeChecked();
    for (const name of parameterNames) {
      await expect(panel.getByRole('slider', { name })).toBeHidden();
    }
    await expect(panel.locator('[data-testid^="pdf-filter-item-"]').nth(0)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-textEnhancement',
    );
    await expect(panel.locator('[data-testid^="pdf-filter-item-"]').nth(1)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-invert',
    );
    await expect.poll(() => pdfAppliedFilterKey(page)).toBe('');

    await enhancement.check();
    await expect(panel.getByRole('slider', { name: 'Толщина штриха' })).toHaveValue('0.7');
    await expect(panel.getByRole('slider', { name: 'Порог' })).toHaveValue('0.62');
    await expect(panel.getByRole('slider', { name: 'Контраст' })).toHaveValue('1.85');
    await expect(panel.getByRole('slider', { name: 'Уровни серого' })).toHaveValue('8');
    await expect(panel.getByRole('slider', { name: 'Сдвиг тона' })).toHaveValue('-0.65');
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }
});

test('PDF reader меняет и сохраняет порядок выключенных фильтров', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const panel = await openPdfFiltersPanel(page);
  const filterItems = panel.locator('[data-testid^="pdf-filter-item-"]');
  const enhancement = panel.getByRole('checkbox', { name: 'Усиление текста' });
  const invert = panel.getByRole('checkbox', { name: 'Инверсия' });

  await expect(filterItems).toHaveCount(6);
  await expect(filterItems.nth(0)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-textEnhancement',
  );
  await expect(filterItems.nth(1)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');
  await expect(filterItems.nth(5)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-softTextEnhancement',
  );

  await reorderPdfFilter(page, 'invert', 'textEnhancement');
  await expect(filterItems.nth(0)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');
  await expect(filterItems.nth(1)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-textEnhancement',
  );
  await expect(invert).not.toBeChecked();

  await expect
    .poll(() =>
      page.evaluate((bookId) => {
        const preferences = JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}');
        return preferences.readers?.pdf?.filterChains?.[bookId]?.map(
          (filter: { id: string }) => filter.id,
        );
      }, pdfOutlineBookId),
    )
    .toEqual([
      'invert',
      'textEnhancement',
      'visualAdjustment',
      'warmth',
      'grayscale',
      'softTextEnhancement',
    ]);

  if (await isWebglAvailable(page)) {
    await enhancement.check();
    await dragRangeToEnd(page, panel.getByRole('slider', { name: 'Порог' }));
    await expect(panel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
    await enhancement.uncheck();
    await expect(panel.getByRole('slider', { name: 'Порог' })).toBeHidden();

    await reorderPdfFilter(page, 'textEnhancement', 'invert');
    await expect(filterItems.nth(0)).toHaveAttribute(
      'data-testid',
      'pdf-filter-item-textEnhancement',
    );
    await expect(filterItems.nth(1)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');

    await enhancement.check();
    await invert.check();
    await expect(panel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
    await expect
      .poll(async () =>
        parsePdfFilterChain(await pdfAppliedFilterKey(page))?.map((filter) => filter.id),
      )
      .toEqual([
        'textEnhancement',
        'invert',
        'visualAdjustment',
        'warmth',
        'grayscale',
        'softTextEnhancement',
      ]);

    await reorderPdfFilter(page, 'invert', 'textEnhancement');
    await expect
      .poll(async () =>
        parsePdfFilterChain(await pdfAppliedFilterKey(page))?.map((filter) => filter.id),
      )
      .toEqual([
        'invert',
        'textEnhancement',
        'visualAdjustment',
        'warmth',
        'grayscale',
        'softTextEnhancement',
      ]);

    await invert.uncheck();
    await enhancement.uncheck();
  }

  await page.goto('/library');
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const reopenedPanel = await openPdfFiltersPanel(page);
  const reopenedItems = reopenedPanel.locator('[data-testid^="pdf-filter-item-"]');

  await expect(reopenedItems.nth(0)).toHaveAttribute('data-testid', 'pdf-filter-item-invert');
  await expect(reopenedItems.nth(1)).toHaveAttribute(
    'data-testid',
    'pdf-filter-item-textEnhancement',
  );
  await expect(reopenedPanel.getByRole('checkbox', { name: 'Инверсия' })).not.toBeChecked();

  if (await isWebglAvailable(page)) {
    await reopenedPanel.getByRole('checkbox', { name: 'Усиление текста' }).check();
    await expect(reopenedPanel.getByRole('slider', { name: 'Порог' })).not.toHaveValue('0.62');
  }
});

test('PDF reader настраивает мягкое утолщение текста отдельно от исходного фильтра', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  const panel = await openPdfFiltersPanel(page);
  const filter = panel.getByTestId('pdf-filter-item-softTextEnhancement');
  const toggle = filter.getByRole('checkbox', { name: 'Мягкое утолщение текста' });

  await expect(toggle).not.toBeChecked();
  await expect(filter.getByRole('slider', { name: 'Толщина штриха' })).toBeHidden();
  await expect(filter.getByRole('slider', { name: 'Сила' })).toBeHidden();

  await toggle.check();

  if (await isWebglAvailable(page)) {
    const strokeWidth = filter.getByRole('slider', { name: 'Толщина штриха' });
    const strength = filter.getByRole('slider', { name: 'Сила' });
    await expect(strokeWidth).toHaveValue('0.65');
    await expect(strength).toHaveValue('0.8');

    await dragRangeToEnd(page, strength);
    await expect(strength).not.toHaveValue('0.8');
    await expect
      .poll(async () => {
        const chain = parsePdfFilterChain(await pdfAppliedFilterKey(page));
        return chain?.find((item) => item.id === 'softTextEnhancement')?.strength;
      })
      .not.toBe(0.8);
  } else {
    await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  }
});

test('PDF reader сохраняет фильтры отдельно для каждой книги', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const preferences = {
      version: 1,
      readers: {
        pdf: {
          filterChains: {
            '00000000-0000-0000-0000-000000000103': [
              { id: 'invert', enabled: true, strength: 0.65 },
            ],
          },
        },
      },
    };
    localStorage.setItem('book-hub-preferences', JSON.stringify(preferences));
  });

  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  const firstPanel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  await expect(firstPanel.getByRole('checkbox', { name: 'Инверсия' })).toBeChecked();

  await page.goto('/library');
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  const secondPanel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  await expect(secondPanel.getByRole('checkbox', { name: 'Инверсия' })).not.toBeChecked();
});

test('PDF reader сохраняет исходное отображение без WebGL', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
  await page.evaluate(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: function getContext(type: string, ...args: unknown[]) {
        if (type === 'webgl') return null;
        return originalGetContext.call(this, type, ...(args as []));
      },
    });
  });
  expect(
    await page.evaluate(() => document.createElement('canvas').getContext('webgl')),
  ).toBeNull();
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  const panel = page
    .locator('aside')
    .filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
  await panel.getByRole('checkbox', { name: 'Инверсия' }).check();
  await expect(panel.getByRole('alert')).toContainText('Фильтры недоступны');
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');
});

test('PDF reader открывает оглавление и переходит к пункту outline', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Second page' })).toBeVisible();
  await page.getByRole('button', { name: 'Second page' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pageTwo = [...document.querySelectorAll('[data-page-number="2"]')].at(0);
        if (!pageTwo) return null;
        return pageTwo.getBoundingClientRect().top;
      }),
    )
    .toBeLessThan(120);
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
});

test('PDF позволяет выделить и скопировать встроенный текст', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();

  const textLayer = page.getByTestId('pdf-text-layer').first();
  await expect(textLayer).toContainText('Book Hub PDF');

  const text = await textLayer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });

  expect(text).toContain('Book Hub PDF');
  expect(text).toContain('Reader story sample');
});

test('PDF reader показывает физическую страницу и ограничивает переход по номеру', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();

  await page.mouse.move(10, 10);
  const pageInput = page.getByRole('spinbutton', { name: 'Номер страницы' });
  await expect(pageInput).toHaveValue('1');
  await expect(page.getByText('/ 2', { exact: true })).toBeVisible();

  await pageInput.fill('999');
  await pageInput.press('Enter');
  await expect(pageInput).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await pageInput.fill('0');
  await pageInput.blur();
  await expect(pageInput).toHaveValue('1');
});

test('PDF reader ищет по текстовым слоям, подсвечивает совпадения и синхронизирует страницу', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'PDF с оглавлением' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);

  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  const nextButton = search.getByRole('button', { name: 'Найти следующее' });
  const previousButton = search.getByRole('button', { name: 'Найти предыдущее' });
  const pdfHighlights = page.getByTestId('pdf-text-layer').locator('.highlight');

  await searchInput.fill('Page');
  await expect(search.getByText('0/0')).toBeVisible();
  await searchInput.press('Enter');
  await expect(search.getByText('1/2')).toBeVisible();
  await expect(pdfHighlights).toHaveCount(2);
  await expect(page.getByTestId('pdf-text-layer').locator('.highlight.selected')).toHaveCount(1);

  await searchInput.fill('One Page');
  await expect(search.getByText('1/2')).toBeVisible();
  await searchInput.press('Enter');
  await expect(search.getByText('0/0')).toBeVisible();
  await expect(pdfHighlights).toHaveCount(0);

  const pageInput = page.getByRole('spinbutton', { name: 'Номер страницы' });
  await pageInput.fill('1');
  await pageInput.press('Enter');
  await searchInput.fill('Page');
  await searchInput.press('Enter');
  await expect(search.getByText('1/2')).toBeVisible();

  const progressResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/books/00000000-0000-0000-0000-000000000103/progress`) &&
      response.request().method() === 'PUT',
  );
  await nextButton.click();
  await expect(search.getByText('2/2')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('2');
  await progressResponse;

  await previousButton.click();
  await expect(search.getByText('1/2')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');

  await nextButton.click();
  await expect(search.getByText('2/2')).toBeVisible();
  await nextButton.click();
  await expect(search.getByText('1/2')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('1');

  await page.locator('[data-page-number="1"]').dispatchEvent('click');
  await expect(pdfHighlights).toHaveCount(0);
  await expect(searchInput).toHaveValue('Page');

  await page.mouse.move(10, 10);
  await searchInput.press('Enter');
  await expect(search.getByText('1/2')).toBeVisible();

  await searchInput.press('Escape');
  await expect(pdfHighlights).toHaveCount(0);
  await expect(searchInput).toHaveValue('Page');
});

test('PDF без текстового слоя не запускает OCR и не показывает совпадения', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/books/00000000-0000-0000-0000-000000000102/file', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: bookMocks.pdfFileWithoutText,
    }),
  );
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();
  await page.mouse.move(10, 10);

  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');

  await searchInput.fill('текст');
  await searchInput.press('Enter');
  await expect(search.getByText('0/0')).toBeVisible();
  await expect(page.getByTestId('pdf-text-layer').locator('.highlight')).toHaveCount(0);
});

test('PDF поисковое выделение совпадает с геометрией найденного текста', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Мастер и Маргарита' }).click();
  await expect(page.getByRole('region', { name: /^Страница 1$/ }).locator('canvas')).toBeVisible();

  const textLayer = page.getByTestId('pdf-text-layer').first();
  await expect(textLayer).toContainText('Reader story sample');
  const expected = await textLayer.evaluate((layer) => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const text = node.textContent ?? '';
      const start = text.indexOf('Reader');

      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 'Reader'.length);
        const rect = range.getBoundingClientRect();

        return { left: rect.left, width: rect.width, height: rect.height };
      }

      node = walker.nextNode();
    }

    return null;
  });

  expect(expected).not.toBeNull();
  await page.mouse.move(10, 10);
  const search = page.getByRole('search');
  const searchInput = search.getByRole('searchbox');
  await searchInput.fill('Reader');
  await searchInput.press('Enter');

  const actualMark = page.getByTestId('pdf-text-layer').locator('.highlight.selected').first();
  await expect(actualMark).toHaveText('Reader');
  await expect(actualMark).toBeVisible();
  let actual: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(async () => {
      actual = await actualMark.boundingBox();
      return actual !== null;
    })
    .toBe(true);
  const actualText = await actualMark.textContent();
  expect(actualText).toBe('Reader');
  expect(actual).not.toBeNull();
  if (!expected || !actual) return;

  expect(Math.abs(actual.x - expected.left)).toBeLessThan(2);
  expect(Math.abs(actual.width - expected.width)).toBeLessThan(2);
  expect(Math.abs(actual.height - expected.height)).toBeLessThan(2);
});
