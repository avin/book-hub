import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';

for (const linkName of ['Библиотека', 'Book Hub']) {
  test(`повторный переход через «${linkName}» сохраняет параметры библиотеки`, async ({ page }) => {
    await login(page);
    const params = new URLSearchParams({
      q: 'роман',
      search_field: 'description',
      sort: 'title_desc',
      favorite: 'favorite',
    });
    params.append('tag', 'роман');
    params.append('tag', 'классика');
    let url = `/library?${params}`;
    await page.goto(url);
    const search = page.getByRole('textbox', { name: 'Поиск книг', exact: true });
    await expect(search).toHaveValue('роман');
    const link = page.getByRole('link', { name: linkName, exact: true });

    await link.click();
    await expect(page).toHaveURL(url);
    await expect(search).toHaveValue('роман');
    await link.click();
    await expect(page).toHaveURL(url);

    await search.fill('приключения');
    params.set('q', 'приключения');
    url = `/library?${params}`;
    await expect(page).toHaveURL(url);
    await expect(link).toHaveAttribute('href', url);
    await link.click();
    await expect(page).toHaveURL(url);

    await page.getByRole('link', { name: 'Загрузка', exact: true }).click();
    await expect(page).toHaveURL('/upload');
    await link.click();
    await expect(page).toHaveURL(url);
    await expect(search).toHaveValue('приключения');
    await page.reload();
    await expect(search).toHaveValue('приключения');
    await expect(page.getByRole('button', { name: 'Где искать', exact: true })).toHaveText(
      'По описанию',
    );
    await expect(
      page.getByRole('button', { name: 'Удалить тег роман', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Удалить тег классика', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Сбросить фильтр', exact: true }).first().click();
    await expect(page).toHaveURL('/library?sort=title_desc');
    await link.click();
    await expect(page).toHaveURL('/library?sort=title_desc');
    await expect(search).toHaveValue('');
  });
}

for (const view of ['Список', 'Сетка']) {
  test(`правый клик по обложке (${view}) открывает меню книги у курсора`, async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: view, exact: true }).click();
    const card = page.getByRole('article').first();
    const cover = card.getByRole('link').first();
    const preview = page.getByRole('dialog', { name: 'Показать обложку целиком', exact: true });

    const coverBounds = await cover.boundingBox();
    expect(coverBounds).not.toBeNull();
    const clickPosition = { x: coverBounds!.x + 20, y: coverBounds!.y + 30 };
    await page.mouse.click(clickPosition.x, clickPosition.y, { button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Информация о книге' })).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await page.getByRole('menu').boundingBox();
        return bounds ? Math.abs(bounds.x - clickPosition.x) : Infinity;
      })
      .toBeLessThan(2);
    const menuBounds = await page.getByRole('menu').boundingBox();
    expect(Math.abs(menuBounds!.y - clickPosition.y)).toBeLessThan(20);
    await expect(preview).toBeHidden();
    await expect(page).toHaveURL(/\/library/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    await cover.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Показать обложку целиком', exact: true }).click();
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await cover.click();
    await expect(page).toHaveURL(`/reader/${books.items[0].id}`);
  });
}

test('поле поиска переключается между названием и описанием и сохраняется в URL', async ({
  page,
}) => {
  const items = [
    { ...books.items[0], title: 'Архитектура', description: 'Морские приключения' },
    { ...books.items[1], title: 'Морские истории', description: 'Роман о горах' },
  ];
  await page.route(`**/api${books.req.list.path}`, (route) => {
    const query = route.request().postDataJSON();
    const field = query.search_field === 'description' ? 'description' : 'title';
    const filtered = items.filter((book) => book[field].toLowerCase().includes(query.q ?? ''));
    return route.fulfill({
      json: { items: filtered, total: filtered.length, limit: 24, offset: 0 },
    });
  });
  await login(page);
  const search = page.getByRole('textbox', { name: 'Поиск книг', exact: true });
  await search.fill('морские');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article').getByRole('heading')).toHaveText('Морские истории');
  await page.getByRole('button', { name: 'Где искать', exact: true }).click();
  await page.getByRole('menuitem', { name: 'По описанию', exact: true }).click();
  await expect(search).toHaveValue('морские');
  await expect(search).toHaveAttribute('placeholder', 'Найти по описанию');
  await expect(page.getByRole('article').getByRole('heading')).toHaveText('Архитектура');
  await expect.poll(() => new URL(page.url()).searchParams.get('search_field')).toBe('description');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Где искать', exact: true })).toHaveText(
    'По описанию',
  );
  await expect(search).toHaveValue('морские');
  await expect(page.getByRole('article').getByRole('heading')).toHaveText('Архитектура');
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Где искать', exact: true }).click();
  await page.getByRole('menuitem', { name: 'По названию', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('search_field')).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(search).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('search-field-mobile.png') });
});

test('клик по тегу добавляет его в фильтр без дубликатов и сохраняет остальные параметры', async ({
  page,
}) => {
  await login(page);
  const initial = new URLSearchParams({
    q: 'Война',
    tag: 'роман',
    sort: 'title_desc',
    favorite: 'favorite',
  });
  await page.goto(`/library?${initial}`);
  const card = page.getByRole('article').first();
  await expect(card.getByRole('heading')).toHaveText('Война и мир');
  const filteredRequest = page.waitForRequest((request) => {
    if (!request.url().endsWith(`/api${books.req.list.path}`)) return false;
    return request.postDataJSON().tags?.includes('классика');
  });
  await card.getByRole('button', { name: 'классика', exact: true }).click();
  expect((await filteredRequest).postDataJSON()).toMatchObject({
    q: 'Война',
    tags: ['роман', 'классика'],
    sort: 'title_desc',
    favorite: true,
  });
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('tag'))
    .toEqual(['роман', 'классика']);
  await card.getByRole('button', { name: 'классика', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['роман', 'классика']);
  expect(new URL(page.url()).pathname).toBe('/library');
  expect(new URL(page.url()).searchParams.get('q')).toBe('Война');
  expect(new URL(page.url()).searchParams.get('sort')).toBe('title_desc');
  expect(new URL(page.url()).searchParams.get('favorite')).toBe('favorite');
});

test('описание сворачивается до двух строк и раскрывается кнопкой', async ({ page, api }) => {
  const description = 'Длинное описание книги с подробностями и примерами. '.repeat(40);
  await api.intercept(books.req.list, {
    items: [
      { ...books.items[0], description },
      { ...books.items[1], description: 'Короткое описание.' },
      { ...books.items[2], description: 'Первая строка\nВторая строка' },
    ],
    total: 3,
    limit: 24,
    offset: 0,
  });
  await login(page);

  const card = page.getByRole('article').first();
  const expand = card.getByRole('button', { name: 'Развернуть', exact: true });
  const paragraph = card.locator('p').filter({
    has: page.getByRole('button', { name: 'Развернуть', exact: true }),
  });
  await expect(expand).toBeVisible();
  await expect(expand.locator('svg')).toBeVisible();
  expect(await paragraph.evaluate((element) => element.firstChild?.textContent)).not.toContain('…');
  await expect.poll(() => paragraph.evaluate((element) => element.clientHeight)).toBe(40);
  await expect(page.getByRole('button', { name: 'Развернуть', exact: true })).toHaveCount(1);
  await card.screenshot({ path: test.info().outputPath('collapsed-description.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => paragraph.evaluate((element) => element.clientHeight)).toBe(40);
  const buttonLine = await expand.evaluate((button) => {
    const paragraph = button.parentElement!;
    return button.getBoundingClientRect().bottom - paragraph.getBoundingClientRect().top;
  });
  expect(buttonLine).toBeGreaterThan(20);
  expect(buttonLine).toBeLessThanOrEqual(40);
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(expand).toHaveCount(0);
  const fullText = card.locator('p:not([aria-hidden])');
  await expect(fullText).toHaveText(description.trim());
  expect(await fullText.evaluate((element) => element.clientHeight)).toBeGreaterThan(40);
  await expect(page).toHaveURL(/\/library/);
});

test('редактор сразу подстраивает высоту описания и сохраняет его без потери переносов', async ({
  page,
  api,
}) => {
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], description: 'Раз\nДва\nТри' }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await login(page);
  await page.getByRole('button', { name: 'Действия с книгой' }).click();
  await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить книгу' });
  const description = dialog.getByRole('textbox', { name: 'Описание', exact: true });
  await expect(description).toHaveValue('Раз\nДва\nТри');
  await expect
    .poll(() => description.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(80);
  await page.screenshot({ path: test.info().outputPath('description-editor.png') });
  await description.fill('  Новый текст\n\nВторой абзац  ');
  await description.press('End');
  await description.press('Enter');
  await expect(dialog).toBeVisible();
  const saved = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/v1/books/'),
  );
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    description: 'Новый текст\n\nВторой абзац',
  });
  await expect(dialog).toBeHidden();
});

test('авторизованный пользователь видит библиотеку', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('heading', { name: /Ваши книги/ })).toContainText('4');
  await expect(page.getByRole('article')).toHaveCount(4);
});

test('много тегов остаются в границах редактора книги при изменении ширины', async ({
  page,
  api,
}) => {
  const tags = Array.from({ length: 20 }, (_, index) => `длинный тег книги ${index + 1}`);
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await login(page);
  await page.getByRole('button', { name: 'Действия с книгой' }).click();
  await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить книгу' });
  const collapsedTags = dialog.getByRole('button', { name: /^\+\d+$/ });

  for (const width of [1280, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1280) {
      await expect
        .poll(() => dialog.evaluate((element) => element.getBoundingClientRect().width))
        .toBe(960);
    }
    await expect(collapsedTags).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            element.scrollWidth <= element.clientWidth &&
            bounds.left >= 0 &&
            bounds.right <= innerWidth
          );
        }),
      )
      .toBe(true);
    const tagInput = dialog.getByRole('combobox', { name: 'Теги' });
    await expect
      .poll(() =>
        tagInput.evaluate((element) => {
          const input = element.getBoundingClientRect();
          const container = element.parentElement!.getBoundingClientRect();
          return input.left >= container.left && input.right <= container.right;
        }),
      )
      .toBe(true);
    await collapsedTags.click();
    await expect(
      dialog.getByRole('button', { name: `Удалить тег ${tags.at(-1)}`, exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: test.info().outputPath(`edit-book-tags-${width}.png`) });
  }
});
