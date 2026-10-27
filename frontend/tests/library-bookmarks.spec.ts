import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import type { LibraryBookmark } from '../src/api/libraryBookmarks';
import { login } from './support/api';

test('поиск в закладке оформлен как в библиотеке и очищает только черновик', async ({ page }) => {
  await login(page);
  const librarySearch = page.getByRole('textbox', { name: 'Поиск книг', exact: true });
  await librarySearch.fill('Война');
  await librarySearch.blur();
  const appearance = (input: HTMLElement) => {
    const styles = (element: Element) => {
      const css = getComputedStyle(element);
      return [css.border, css.borderRadius, css.backgroundColor, css.minHeight, css.padding];
    };
    return { input: styles(input), container: styles(input.parentElement!) };
  };
  const expectedAppearance = await librarySearch.evaluate(appearance);
  await page.getByRole('button', { name: 'Создать закладку', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
  const search = dialog.getByRole('textbox', { name: 'Поиск книг', exact: true });
  await search.blur();
  expect(await search.evaluate(appearance)).toEqual(expectedAppearance);
  await dialog.getByRole('button', { name: 'Где искать' }).click();
  await page.getByRole('menuitem', { name: 'По описанию' }).click();
  await expect(search).toHaveAttribute('placeholder', 'Найти по описанию');
  await search.fill('черновик');
  await expect(search).toBeFocused();
  await dialog.getByRole('button', { name: 'Очистить поиск' }).click();
  await expect(search).toHaveValue('');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(librarySearch).toHaveValue('Война');
});

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
  await page.getByRole('button', { name: 'Создать закладку', exact: true }).click();
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

test('подсветка закладки затухает вместе с областью кнопки редактирования', async ({ page }) => {
  await mockSettings(page, [bookmark('hover', 'Выборка')]);
  await login(page);
  const link = page.getByRole('button', { name: 'Выборка', exact: true });
  const row = page.locator('[data-bookmark-id="hover"]');
  await link.hover();
  await row.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
  await page.mouse.move(0, 0);
  const fading = await row.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find(
        (item) => item instanceof CSSTransition && item.transitionProperty === 'background-color',
      );
    if (!animation) return null;
    animation.pause();
    animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
    return {
      background: getComputedStyle(element).backgroundColor,
      buttons: Array.from(element.querySelectorAll('button')).map(
        (button) => getComputedStyle(button).backgroundColor,
      ),
    };
  });
  expect(fading).not.toBeNull();
  expect(fading!.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(fading!.buttons).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
});

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
  await page.getByRole('button', { name: 'Создать закладку', exact: true }).click();
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
    await page.getByRole('button', { name: 'Создать закладку', exact: true }).click();
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
    name: 'Редактировать закладку Дубликат',
    exact: true,
    includeHidden: true,
  });
  await expect(remove.first()).toBeVisible();
  await expect(remove.last()).toBeHidden();
  await remove.first().click();
  const editor = page.getByRole('dialog', { name: 'Редактировать закладку', exact: true });
  await editor.getByRole('button', { name: 'Удалить', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Удалить закладку', exact: true });
  await expect(confirm.getByText('Дубликат', { exact: true })).toBeVisible();
  await confirm.getByRole('button', { name: 'Нет', exact: true }).click();
  await editor.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: 'Удалить', exact: true }).click();
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
  await list.getByRole('button', { name: 'Создать закладку', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
  await expect(list).toBeHidden();
  await expect(form.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('');
  await expect(form.getByRole('button', { name: 'Где искать' })).toHaveText('По названию');
  await form.getByRole('button', { name: 'Отмена' }).click();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: 'Создать закладку', exact: true }).click();
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
    await expect(
      page.getByRole('button', { name: 'Создать закладку', exact: true }),
    ).toBeInViewport();
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
  test('длительное нажатие раскрывает редактирование без применения, нажатие снаружи скрывает кнопку', async ({
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
    const remove = list.getByRole('button', { name: 'Редактировать закладку Первая', exact: true });
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
    await page.getByRole('button', { name: 'Создать закладку', exact: true }).click();
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

for (const mobile of [false, true]) {
  for (const count of [0, 2]) {
    test(`создание расположено сразу после ${count ? 'закладок' : 'начала списка'} (${mobile ? 'mobile' : 'desktop'})`, async ({
      page,
    }) => {
      await mockSettings(
        page,
        Array.from({ length: count }, (_, index) => bookmark(String(index), `Выборка ${index}`)),
      );
      await page.setViewportSize({ width: mobile ? 390 : 1100, height: 800 });
      await login(page);
      if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
      const previous = count
        ? page.getByRole('button', { name: `Выборка ${count - 1}`, exact: true })
        : mobile
          ? page.getByRole('heading', { name: 'Закладки', exact: true })
          : page.getByRole('link', { name: 'Настройки', exact: true });
      const previousBounds = await previous.boundingBox();
      const create = page.getByRole('button', { name: 'Создать закладку', exact: true });
      const bounds = await create.boundingBox();
      const gap = bounds!.y - previousBounds!.y - previousBounds!.height;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(count ? 20 : 60);
    });
  }
}

for (const view of ['Список', 'Сетка']) {
  test(`окна закладок перекрывают фильтры и книги (${view})`, async ({ page }) => {
    await mockSettings(page, [bookmark('one', 'Моя выборка')]);
    await login(page);
    await page.getByRole('button', { name: view, exact: true }).click();
    const background = page.locator('main');
    const search = background.getByRole('textbox', { name: 'Поиск книг', exact: true });
    const book = background.getByRole('article').first();
    await expect(book).toBeVisible();
    const covered = async () => {
      for (const target of [search, book]) {
        await expect
          .poll(() =>
            target.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const top = document.elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + Math.min(bounds.height / 2, 40),
              );
              return top !== null && !element.contains(top);
            }),
          )
          .toBe(true);
      }
    };
    await page.getByRole('button', { name: 'Создать закладку', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Создать закладку', exact: true });
    await expect(form).toBeVisible();
    await covered();
    await form.getByRole('textbox', { name: 'Название', exact: true }).fill('Проверка слоёв');
    await page.screenshot({ path: test.info().outputPath('bookmark-form.png') });
    await form.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: 'Моя выборка', exact: true }).hover();
    await page
      .getByRole('button', { name: 'Редактировать закладку Моя выборка', exact: true })
      .click();
    await covered();
    await page
      .getByRole('dialog', { name: 'Редактировать закладку', exact: true })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await covered();
    await page
      .getByRole('dialog', { name: 'Удалить закладку', exact: true })
      .getByRole('button', { name: 'Нет', exact: true })
      .click();
  });
}

test('кнопка создания и закладки выровнены с основными пунктами меню', async ({ page }) => {
  await mockSettings(page, [bookmark('one', 'Моя выборка'), bookmark('two', 'Другая выборка')]);
  await login(page);
  const active = page.getByRole('link', { name: 'Библиотека', exact: true });
  const activeColor = await active.evaluate((element) => getComputedStyle(element).color);
  await active.hover();
  await expect(active).toHaveCSS('color', activeColor);
  const reference = page.getByRole('link', { name: 'Настройки', exact: true });
  const referenceText = await reference.getByText('Настройки', { exact: true }).boundingBox();
  const referenceIcon = await reference.locator('svg').boundingBox();
  for (const name of ['Создать закладку', 'Моя выборка', 'Другая выборка']) {
    const item = page.getByRole('button', { name, exact: true });
    const label = await item.getByText(name, { exact: true }).boundingBox();
    expect(Math.abs(label!.x - referenceText!.x)).toBeLessThan(1);
    await expect(item.locator('svg')).toHaveCount(1);
    const icon = await item.locator('svg').boundingBox();
    expect(Math.abs(icon!.x - referenceIcon!.x)).toBeLessThan(1);
    expect(icon!.width).toBe(referenceIcon!.width);
    expect(icon!.height).toBe(referenceIcon!.height);
    const itemStyle = await item.evaluate((element) => {
      const style = getComputedStyle(element);
      return { padding: style.padding, font: style.font, textAlign: style.textAlign };
    });
    expect(itemStyle).toEqual(
      await reference.evaluate((element) => {
        const style = getComputedStyle(element);
        return { padding: style.padding, font: style.font, textAlign: style.textAlign };
      }),
    );
  }
  const upload = await page.getByRole('link', { name: 'Загрузка', exact: true }).boundingBox();
  const settings = await reference.boundingBox();
  const expectedGap = settings!.y - upload!.y - upload!.height;
  let previous = await page.getByRole('button', { name: 'Моя выборка', exact: true }).boundingBox();
  for (const name of ['Другая выборка', 'Создать закладку']) {
    const current = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(current!.height).toBe(settings!.height);
    expect(current!.y - previous!.y - previous!.height).toBe(expectedGap);
    previous = current;
  }
  await page.screenshot({ path: test.info().outputPath('bookmark-menu.png') });
});

for (const mobile of [false, true]) {
  test(`редактирование сохраняет параметры и место закладки, отмена сохраняет черновик (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    const original = bookmark('one', 'Моя выборка', {
      search: 'старое',
      searchField: 'description',
      tags: ['роман'],
    });
    const settings = await mockSettings(page, [original, bookmark('two', 'Другая')]);
    await page.setViewportSize({ width: mobile ? 390 : 1100, height: 844 });
    await login(page);
    await page.goto('/library?q=выдача');
    if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
    const entry = page.getByRole('button', { name: 'Моя выборка', exact: true });
    if (mobile) {
      await entry.focus();
      await page.keyboard.press('ArrowDown');
    } else await entry.hover();
    await page
      .getByRole('button', { name: 'Редактировать закладку Моя выборка', exact: true })
      .click();
    const editor = page.getByRole('dialog', { name: 'Редактировать закладку', exact: true });
    const name = editor.getByRole('textbox', { name: 'Название', exact: true });
    const search = editor.getByRole('textbox', { name: 'Поиск книг', exact: true });
    await expect(name).toHaveValue('Моя выборка');
    await expect(search).toHaveValue('старое');
    await expect(editor.getByRole('button', { name: 'Где искать' })).toHaveText('По описанию');
    await expect(editor.getByRole('button', { name: 'Удалить тег роман' })).toBeVisible();
    await name.fill('  Новая выборка  ');
    await search.fill('новое');
    await editor.getByRole('button', { name: 'Где искать' }).click();
    await page.getByRole('menuitem', { name: 'По названию' }).click();
    await editor.getByRole('button', { name: 'Удалить тег роман' }).click();
    const tags = editor.getByRole('combobox', { name: 'Теги', exact: true });
    await tags.fill('новый');
    await tags.press('Enter');
    const remove = editor.getByRole('button', { name: 'Удалить', exact: true });
    const cancel = editor.getByRole('button', { name: 'Отмена', exact: true });
    const removeBounds = await remove.boundingBox();
    const cancelBounds = await cancel.boundingBox();
    expect(removeBounds!.x).toBeLessThan(cancelBounds!.x);
    expect(Math.abs(removeBounds!.y - cancelBounds!.y)).toBeLessThan(1);
    await remove.click();
    await page
      .getByRole('dialog', { name: 'Удалить закладку', exact: true })
      .getByRole('button', { name: 'Нет', exact: true })
      .click();
    await expect(name).toHaveValue('  Новая выборка  ');
    await expect(search).toHaveValue('новое');
    expect(settings().libraryBookmarks[0]).toEqual(original);
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(editor).toBeHidden();
    expect(settings().libraryBookmarks).toEqual([
      bookmark('one', 'Новая выборка', { search: 'новое', tags: ['новый'] }),
      bookmark('two', 'Другая'),
    ]);
    expect(settings().unrelated).toEqual({ keep: 42 });
    if (mobile)
      await page
        .getByRole('dialog', { name: 'Закладки', exact: true })
        .getByRole('button', { name: 'Закрыть', exact: true })
        .click();
    await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
      'выдача',
    );
    await page.reload();
    if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
    await page.getByRole('button', { name: 'Новая выборка', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
      'новое',
    );
    await expect(page).toHaveURL(/tag=/);
  });
}
