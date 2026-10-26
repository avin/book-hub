import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import type { LibraryBookmark } from '../src/api/libraryBookmarks';
import { login } from './support/api';

test('создание сохраняет фильтры отдельно от выдачи и восстанавливает закладку после перезагрузки', async ({
  page,
}) => {
  let settings: Record<string, unknown> = { theme: 'dark', custom: { keep: true } };
  await page.route('**/api/v1/me/settings', async (route) => {
    if (route.request().method() === 'PUT') settings = route.request().postDataJSON();
    await route.fulfill({ json: settings });
  });
  await login(page);
  await page.getByRole('textbox', { name: 'Поиск книг', exact: true }).fill('Война');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
    'Война',
  );
  await dialog.getByRole('textbox', { name: 'Название', exact: true }).fill('  Морские  ');
  await dialog.getByRole('textbox', { name: 'Поиск книг', exact: true }).fill('морские');
  await dialog.getByRole('button', { name: 'Где искать' }).click();
  await page.getByRole('menuitem', { name: 'По описанию' }).click();
  await dialog.getByRole('button', { name: 'Создать закладку', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('Война');
  expect(settings.custom).toEqual({ keep: true });
  await page.reload();
  await page.getByRole('button', { name: 'Морские', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
    'морские',
  );
  await expect(page).toHaveURL(/search_field=description/);
});

function bookmark(
  id: string,
  name = 'Выборка',
  filters: Partial<LibraryBookmark> = {},
): LibraryBookmark {
  return { id, name, search: '', searchField: 'title', tags: [], ...filters };
}

async function mockSettings(page: Page, items: LibraryBookmark[] = []) {
  let settings = { language: 'ru', unrelated: { keep: 42 }, libraryBookmarks: items };
  await page.route('**/api/v1/me/settings', async (route) => {
    if (route.request().method() === 'PUT') settings = route.request().postDataJSON();
    await route.fulfill({ json: settings });
  });
  return () => settings;
}

for (const route of ['/library', '/upload', '/settings']) {
  for (const favorite of ['favorite', 'regular']) {
    test(`пустая закладка полностью заменяет фильтры из ${route}, избранное ${favorite}`, async ({
      page,
    }) => {
      await mockSettings(page, [bookmark('empty', 'Все книги')]);
      await login(page);
      await page.goto(
        `/library?q=старое&search_field=description&tag=старый&favorite=${favorite}&sort=title_desc`,
      );
      await page.getByRole('button', { name: 'Сетка', exact: true }).click();
      if (route !== '/library')
        await page
          .getByRole('link', { name: route === '/upload' ? 'Загрузка' : 'Настройки', exact: true })
          .click();
      const request = page.waitForRequest(
        (req) =>
          req.url().endsWith('/v1/books/query') &&
          req.postDataJSON().q === '' &&
          req.postDataJSON().favorite === null,
      );
      await page.getByRole('button', { name: 'Все книги', exact: true }).click();
      await request;
      await expect(page).toHaveURL(/\/library\?sort=title_desc$/);
      await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Сетка', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: 'Все книги', exact: true })).not.toHaveClass(
        /active/,
      );
      await page.getByRole('link', { name: 'Настройки', exact: true }).click();
      await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
      await expect(page).toHaveURL(/\/library\?sort=title_desc$/);
    });
  }
}

test('черновик независим, предзаполняется на других страницах, проверяет имя и сохраняет дубликаты', async ({
  page,
}) => {
  const settings = await mockSettings(page);
  await login(page);
  await page.goto('/library?q=Война&search_field=description&tag=роман');
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue(
    'Закладка',
  );
  await expect(dialog.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
    'Война',
  );
  await expect(dialog.getByRole('button', { name: 'Где искать' })).toHaveText('По описанию');
  await expect(dialog.getByRole('button', { name: 'Удалить тег роман' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Поиск книг', exact: true }).fill('черновик');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('Война');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Название', exact: true });
    await name.fill('   ');
    await dialog.getByRole('button', { name: 'Создать закладку', exact: true }).click();
    await expect(dialog.getByText('Введите название длиной от 1 до 100 символов')).toBeVisible();
    await name.fill('Д'.repeat(101));
    await expect(name).toHaveValue('Д'.repeat(100));
    await name.fill('  Дубликат  ');
    const tags = dialog.getByRole('combobox', { name: 'Теги', exact: true });
    await tags.fill(' Новый ');
    await tags.press('Enter');
    await dialog.getByRole('button', { name: 'Создать закладку', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  expect(settings().unrelated).toEqual({ keep: 42 });
  expect(settings().libraryBookmarks.map((item) => item.name)).toEqual(['Дубликат', 'Дубликат']);
  expect(settings().libraryBookmarks[0].tags).toEqual(['роман', 'новый']);
  expect(settings().libraryBookmarks[0].id).not.toBe(settings().libraryBookmarks[1].id);
  const entries = page.getByRole('button', { name: 'Дубликат', exact: true });
  await entries.first().hover();
  const remove = page.getByRole('button', {
    name: 'Удалить закладку Дубликат',
    exact: true,
    includeHidden: true,
  });
  await expect(remove.first()).toBeVisible();
  await expect(remove.last()).toBeHidden();
  await remove.first().click();
  const confirm = page.getByRole('dialog', { name: 'Удалить закладку', exact: true });
  await expect(confirm.getByText('Дубликат', { exact: true })).toBeVisible();
  await confirm.getByRole('button', { name: 'Нет', exact: true }).click();
  await entries.first().hover();
  await remove.first().click();
  await page.keyboard.press('Escape');
  await entries.first().hover();
  await remove.first().click();
  await confirm.getByRole('button', { name: 'Да', exact: true }).click();
  await expect(entries).toHaveCount(1);
  expect(settings().libraryBookmarks).toHaveLength(1);
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('Война');
});

test('до посещения библиотеки форма пуста, мобильный цикл возвращает к списку', async ({
  page,
}) => {
  await mockSettings(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/settings'); // Новая загрузка приложения без посещения библиотеки.
  await page.getByRole('button', { name: 'Закладки', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Закладки', exact: true });
  await list.getByRole('button', { name: 'Создать', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
  await expect(list).toBeHidden();
  await expect(form.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('');
  await expect(form.getByRole('button', { name: 'Где искать' })).toHaveText('По названию');
  await form.getByRole('button', { name: 'Отмена' }).click();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: 'Создать', exact: true }).click();
  await form.getByRole('button', { name: 'Создать закладку', exact: true }).click();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: 'Закладка', exact: true }).click();
  await expect(list).toBeHidden();
  await expect(page).toHaveURL(/\/library$/);
});

for (const mobile of [false, true]) {
  test(`длинный список и подписи сохраняют доступ к созданию (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await mockSettings(
      page,
      Array.from({ length: 80 }, (_, index) =>
        bookmark(String(index), `Закладка ${index} ${'длинное название '.repeat(4)}`),
      ),
    );
    await page.setViewportSize({ width: mobile ? 390 : 1100, height: 600 });
    await login(page);
    if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
    const last = page.getByRole('button', { name: /^Закладка 79 / });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeInViewport();
    if (!mobile) {
      await expect(page.getByRole('button', { name: 'Язык', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeInViewport();
      await expect(page.getByRole('link', { name: 'Настройки', exact: true })).toBeInViewport();
    }
    if (mobile) {
      const bounds = await page
        .getByRole('dialog', { name: 'Закладки', exact: true })
        .boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      expect((await last.boundingBox())!.width).toBeLessThanOrEqual(bounds!.width);
    }
    await last.hover();
    await expect(last).toHaveAttribute('title', /Закладка 79/);
    const size = await last.boundingBox();
    expect(size!.height).toBeLessThan(55);
    await page.screenshot({
      path: test.info().outputPath(`bookmarks-${mobile ? 'mobile' : 'desktop'}.png`),
    });
  });
}

test.describe('сенсорное управление', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('длительное нажатие раскрывает удаление без применения, нажатие снаружи скрывает крестик', async ({
    page,
  }) => {
    await mockSettings(page, [
      bookmark('one', 'Первая', { search: 'Война' }),
      bookmark('two', 'Вторая'),
    ]);
    await login(page);
    await page.getByRole('button', { name: 'Закладки', exact: true }).tap();
    const list = page.getByRole('dialog', { name: 'Закладки', exact: true });
    const first = list.getByRole('button', { name: 'Первая', exact: true });
    const remove = list.getByRole('button', { name: 'Удалить закладку Первая', exact: true });
    await expect(remove).toBeHidden();
    const bounds = await first.boundingBox();
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds!.x + 30, y: bounds!.y + 15 }],
    });
    await page.waitForTimeout(650); // Продолжительность пользовательского жеста.
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(remove).toBeVisible();
    await expect(list).toBeVisible();
    await list.getByRole('heading', { name: 'Закладки', exact: true }).tap();
    await expect(remove).toBeHidden();
    await first.tap();
    await expect(list).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
      'Война',
    );
  });
});

test('закладка заменяет поиск, поле и теги, выдача начинается сверху и согласована с запросом', async ({
  page,
}) => {
  await mockSettings(page, [
    bookmark('filtered', 'Морские романы', {
      search: 'морские',
      searchField: 'description',
      tags: ['роман', 'море'],
    }),
  ]);
  await login(page);
  await page.goto('/library?q=старое&tag=старый&favorite=favorite&sort=title_asc');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const request = page.waitForRequest(
    (req) => req.url().endsWith('/v1/books/query') && req.postDataJSON().q === 'морские',
  );
  await page.getByRole('button', { name: 'Морские романы', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    q: 'морские',
    search_field: 'description',
    tags: ['роман', 'море'],
    favorite: null,
    sort: 'title_asc',
    offset: 0,
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
    'морские',
  );
  const params = new URL(page.url()).searchParams;
  expect(params.getAll('tag')).toEqual(['роман', 'море']);
  expect(params.has('favorite')).toBe(false);
});

test('создание доступно без randomUUID на HTTP домашнего сервера', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }),
  );
  const settings = await mockSettings(page);
  await login(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
    await form.getByRole('button', { name: 'Создать закладку', exact: true }).click();
    await expect(form).toBeHidden();
  }
  expect(settings().libraryBookmarks).toHaveLength(2);
  expect(settings().libraryBookmarks[0].id).not.toBe(settings().libraryBookmarks[1].id);
});

test('закладка применяется при нажатии до загрузки страницы библиотеки', async ({ page }) => {
  await mockSettings(page, [
    bookmark('early', 'Ранняя закладка', {
      search: 'морские',
      searchField: 'description',
      tags: ['роман'],
    }),
  ]);
  await login(page);
  await page.goto('/library?q=Война');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/LibraryPage-*.js', async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Ранняя закладка', exact: true }).click();
  release();
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
    'морские',
  );
  await expect(page.getByRole('button', { name: 'Где искать' })).toHaveText('По описанию');
});
