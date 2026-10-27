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
    for (const animation of input.parentElement!.getAnimations({ subtree: true }))
      animation.finish();
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

async function dragBookmark(page: Page, id: string, targetId: string) {
  const handle = page.locator(`[data-bookmark-id="${id}"] [data-bookmark-drag-handle]`);
  const source = (await handle.boundingBox())!;
  const target = (await page.locator(`[data-bookmark-id="${targetId}"]`).boundingBox())!;
  const x = source.x + source.width / 2;
  await page.mouse.move(x, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, source.y + source.height / 2 + 7, { steps: 3 });
  await page.mouse.move(x, target.y + target.height / 2, { steps: 20 });
  await expect(page.locator('[data-bookmark-id]').first()).toHaveAttribute(
    'data-bookmark-id',
    targetId,
  );
  await page.mouse.up();
}

test('сохранение порядка не меняет вид и доступность кнопок', async ({ page }) => {
  await mockSettings(page, [bookmark('one', 'А'), bookmark('two', 'Б')]);
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/me/settings', async (route) => {
    if (route.request().method() === 'PUT') await gate;
    await route.fallback();
  });
  try {
    await dragBookmark(page, 'one', 'two');
    for (const id of ['one', 'two']) {
      const handle = page.locator(`[data-bookmark-id="${id}"] [data-bookmark-drag-handle]`);
      await expect(handle).toBeEnabled();
      await expect(handle).toHaveCSS('opacity', '1');
      await expect(page.locator(`[data-bookmark-id="${id}"] [data-bookmark-edit]`)).toBeEnabled();
    }
    await expect(page.getByRole('button', { name: 'Создать закладку', exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test('ответ сервера после переноса сохраняет строку под курсором и её hover', async ({ page }) => {
  await mockSettings(page, [bookmark('one', 'А'), bookmark('two', 'Б')]);
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/me/settings', async (route) => {
    if (route.request().method() === 'PUT') await gate;
    await route.fallback();
  });
  try {
    await dragBookmark(page, 'one', 'two');
    const row = page.locator('[data-bookmark-id="one"]');
    await expect.poll(() => row.evaluate((element) => element.matches(':hover'))).toBe(true);
    const original = await row.elementHandle();
    await row.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true })) animation.finish();
    });
    const background = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
    const response = page.waitForResponse(
      (res) => res.url().endsWith('/v1/me/settings') && res.request().method() === 'PUT',
    );
    release();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect.poll(() => original!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(row).toHaveCSS('background-color', background);
    expect(await row.evaluate((element, previous) => element === previous, original)).toBe(true);
    await expect.poll(() => row.evaluate((element) => element.matches(':hover'))).toBe(true);
  } finally {
    release();
  }
});

for (const mobile of [false, true]) {
  test(`перетаскивание за иконку сохраняет порядок (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    const saved = await mockSettings(page, [
      bookmark('one', 'А'),
      bookmark('two', 'Б'),
      bookmark('three', 'В'),
    ]);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const open = async () => {
      if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
    };
    await open();
    await dragBookmark(page, 'one', 'two');
    await expect
      .poll(() => saved().libraryBookmarks.map((item) => item.id))
      .toEqual(['two', 'one', 'three']);
    await expect(page.getByRole('button', { name: 'А', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.reload();
    await open();
    await expect(page.locator('[data-bookmark-id]').first()).toHaveAttribute(
      'data-bookmark-id',
      'two',
    );
    await dragBookmark(page, 'two', 'one');
    await expect
      .poll(() => saved().libraryBookmarks.map((item) => item.id))
      .toEqual(['one', 'two', 'three']);
    expect(saved().unrelated).toEqual({ keep: 42 });
    const link = page.getByRole('button', { name: 'А', exact: true });
    const bounds = (await link.boundingBox())!;
    const edit = page.getByRole('button', { name: 'Редактировать закладку А', exact: true });
    await link.hover();
    expect(bounds.x + bounds.width).toBeCloseTo((await edit.boundingBox())!.x, 0);
    await link.click({ position: { x: bounds.width - 3, y: bounds.height / 2 } });
    if (mobile) await open();
    await expect(link).toHaveAttribute('aria-pressed', 'true');
  });
}

test('ошибка сохранения порядка возвращает исходный список и позволяет повторить', async ({
  page,
}) => {
  const saved = await mockSettings(page, [bookmark('one', 'А'), bookmark('two', 'Б')]);
  await login(page);
  let fail = true;
  await page.route('**/api/v1/me/settings', async (route) => {
    if (fail && route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, json: { error: 'internal_error' } });
    } else await route.fallback();
  });
  await dragBookmark(page, 'one', 'two');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-bookmark-id]').first()).toHaveAttribute(
    'data-bookmark-id',
    'one',
  );
  await expect(page.locator('[data-bookmark-drag-handle]').first()).toBeEnabled();
  fail = false;
  await dragBookmark(page, 'one', 'two');
  await expect.poll(() => saved().libraryBookmarks.map((item) => item.id)).toEqual(['two', 'one']);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('подсветка закладки затухает вместе с областью кнопки редактирования', async ({ page }) => {
  await mockSettings(page, [bookmark('hover', 'Выборка')]);
  await login(page);
  const link = page.getByRole('button', { name: 'Выборка', exact: true });
  const row = page.locator('[data-bookmark-id="hover"]');
  await link.hover();
  await row.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
    element.addEventListener('transitionrun', (event) => {
      if (
        event.target !== element ||
        (event as TransitionEvent).propertyName !== 'background-color'
      )
        return;
      for (const animation of element.getAnimations()) {
        if (
          animation instanceof CSSTransition &&
          animation.transitionProperty === 'background-color'
        )
          animation.pause();
      }
    });
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
  expect(fading!.buttons).toEqual(Array(3).fill('rgba(0, 0, 0, 0)'));
});

for (const route of ['/library', '/upload', '/settings']) {
  for (const favorite of ['favorite', 'regular']) {
    test(`пустая закладка заменяет поиск и теги из ${route}, сохраняя избранное ${favorite}`, async ({
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
          req.postDataJSON().favorite === (favorite === 'favorite'),
      );
      await page.getByRole('button', { name: 'Все книги', exact: true }).click();
      await request;
      await expect(page).toHaveURL(new RegExp(`/library\\?sort=title_desc&favorite=${favorite}$`));
      await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Сетка', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: 'Все книги', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('link', { name: 'Настройки', exact: true }).click();
      await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/library\\?sort=title_desc&favorite=${favorite}$`));
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
    'Война роман',
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
  test('перетаскивание пальцем за иконку меняет порядок и не открывает закладку', async ({
    page,
  }) => {
    const saved = await mockSettings(page, [bookmark('one', 'А'), bookmark('two', 'Б')]);
    await login(page);
    await page.getByRole('button', { name: 'Закладки', exact: true }).tap();
    const handle = (await page
      .locator('[data-bookmark-id="one"] [data-bookmark-drag-handle]')
      .boundingBox())!;
    const target = (await page.locator('[data-bookmark-id="two"]').boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + ((target.y + target.height / 2 - y) * step) / 12 }],
      });
      await page.waitForTimeout(25); // Продолжительность пользовательского жеста.
    }
    await expect(page.locator('[data-bookmark-id]').first()).toHaveAttribute(
      'data-bookmark-id',
      'two',
    );
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(() => saved().libraryBookmarks.map((item) => item.id))
      .toEqual(['two', 'one']);
    await expect(page.getByRole('dialog', { name: 'Закладки', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'А', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await session.detach();
  });
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
    favorite: true,
    sort: 'title_asc',
    offset: 0,
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
    'морские',
  );
  const params = new URL(page.url()).searchParams;
  expect(params.getAll('tag')).toEqual(['роман', 'море']);
  expect(params.get('favorite')).toBe('favorite');
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
    const iconLocator =
      name === 'Создать закладку'
        ? item.locator('svg')
        : page
            .getByRole('button', { name: `Переместить закладку ${name}`, exact: true })
            .locator('svg');
    await expect(iconLocator).toHaveCount(1);
    const icon = await iconLocator.boundingBox();
    expect(Math.abs(icon!.x - referenceIcon!.x)).toBeLessThan(1);
    expect(icon!.width).toBe(referenceIcon!.width);
    expect(icon!.height).toBe(referenceIcon!.height);
    const itemStyle = await item.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        font: style.font,
        textAlign: style.textAlign,
      };
    });
    expect(itemStyle).toEqual(
      await reference.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          font: style.font,
          textAlign: style.textAlign,
        };
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

for (const mobile of [false, true]) {
  test(`активная закладка сохраняется после перезагрузки и сбрасывается при поиске (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await mockSettings(page, [
      bookmark('one', 'Первая', { search: 'Война' }),
      bookmark('two', 'Вторая', { search: 'Война' }),
    ]);
    await page.setViewportSize({ width: mobile ? 390 : 1100, height: 844 });
    await login(page);
    const open = async () => {
      if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
    };
    const first = page.getByRole('button', { name: 'Первая', exact: true });
    const second = page.getByRole('button', { name: 'Вторая', exact: true });
    await open();
    await first.click();
    await expect(page).toHaveURL(/q=/);
    await page.reload();
    await open();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    const activeBackground = await page
      .getByRole('link', { name: 'Библиотека', exact: true })
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(page.locator('[data-bookmark-id="one"]')).toHaveCSS(
      'background-color',
      activeBackground,
    );
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await second.click();
    await open();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    if (mobile) await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('textbox', { name: 'Поиск книг', exact: true }).fill('новый запрос');
    await open();
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    if (mobile) await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.reload();
    await open();
    await expect(second).toHaveAttribute('aria-pressed', 'false');
  });
}

test('открытие книги и возврат назад сохраняют выбранную закладку', async ({ page }) => {
  await mockSettings(page, [
    bookmark('one', 'Первая', { search: 'Война' }),
    bookmark('two', 'Вторая', { search: 'Война' }),
  ]);
  await login(page);
  const entry = page.getByRole('button', { name: 'Вторая', exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  const libraryUrl = page.url();
  await page.getByRole('article').first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await page.goBack();
  await expect(page).toHaveURL(libraryUrl);
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Первая', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue('Война');
  await page.reload();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
});

for (const section of ['Загрузка', 'Настройки']) {
  for (const mobile of [false, true]) {
    for (const returnBy of ['menu', 'history']) {
      test(`подсветка закладки скрывается в разделе ${section} и восстанавливается при возврате (${mobile ? 'mobile' : 'desktop'}, ${returnBy})`, async ({
        page,
      }) => {
        const filters = { search: 'Война', tags: ['роман'] };
        await mockSettings(page, [
          bookmark('one', 'Первая', filters),
          bookmark('two', 'Моя выборка', filters),
        ]);
        await page.setViewportSize({ width: mobile ? 390 : 1100, height: 844 });
        await login(page);
        const open = async () => {
          if (mobile) await page.getByRole('button', { name: 'Закладки', exact: true }).click();
        };
        const close = async () => {
          if (mobile) await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
        };
        const entry = page.getByRole('button', { name: 'Моя выборка', exact: true });
        await open();
        await entry.click();
        await expect(page).toHaveURL(/tag=/);
        const libraryUrl = page.url();
        await open();
        await expect(entry).toHaveAttribute('aria-pressed', 'true');
        await close();
        await page.getByRole('link', { name: section, exact: true }).click();
        await expect(page).toHaveURL(section === 'Загрузка' ? '/upload' : '/settings');
        await open();
        await expect(entry).toHaveAttribute('aria-pressed', 'false');
        await close();
        if (returnBy === 'menu') {
          await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
        } else {
          await page.goBack();
        }
        await expect(page).toHaveURL(libraryUrl);
        await expect(page.getByRole('textbox', { name: 'Поиск книг', exact: true })).toHaveValue(
          'Война',
        );
        await open();
        await expect(entry).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Первая', exact: true })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
        await page.reload();
        await open();
        await expect(entry).toHaveAttribute('aria-pressed', 'true');
      });
    }
  }
}

for (const resetButton of ['header', 'emptyState'] as const) {
  test(`очистка фильтров сбрасывает закладку только с тегами (${resetButton})`, async ({
    page,
  }) => {
    const tag = resetButton === 'header' ? 'роман' : 'несуществующий';
    await mockSettings(page, [bookmark('one', 'Моя выборка', { tags: [tag] })]);
    await login(page);
    const entry = page.getByRole('button', { name: 'Моя выборка', exact: true });
    await entry.click();
    await expect(entry).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: `Удалить тег ${tag}` })).toBeVisible();
    const reset = page.getByRole('button', { name: 'Сбросить фильтр', exact: true });
    await reset.nth(resetButton === 'header' ? 0 : 1).click();
    await expect(page.getByRole('button', { name: `Удалить тег ${tag}` })).toBeHidden();
    await expect(entry).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(entry).toHaveAttribute('aria-pressed', 'false');
  });
}

for (const filter of ['tags', 'favorite'] as const) {
  test(`изменение фильтра ${filter} ${filter === 'tags' ? 'сбрасывает' : 'сохраняет'} выбор закладки`, async ({
    page,
  }) => {
    await mockSettings(page, [bookmark('one', 'Моя выборка', { tags: ['роман'] })]);
    await login(page);
    const entry = page.getByRole('button', { name: 'Моя выборка', exact: true });
    await entry.click();
    await expect(entry).toHaveAttribute('aria-pressed', 'true');
    if (filter === 'tags') {
      await page.getByRole('button', { name: 'Удалить тег роман' }).click();
    } else {
      await page.getByRole('button', { name: 'Сортировка', exact: true }).click();
      await page.getByRole('button', { name: 'Избранные', exact: true }).click();
    }
    await expect(entry).toHaveAttribute('aria-pressed', filter === 'tags' ? 'false' : 'true');
    await page.reload();
    await expect(entry).toHaveAttribute('aria-pressed', filter === 'tags' ? 'false' : 'true');
  });
}

test('очистка только избранного сохраняет выбор закладки', async ({ page }) => {
  await mockSettings(page, [bookmark('one', 'Моя выборка')]);
  await login(page);
  const entry = page.getByRole('button', { name: 'Моя выборка', exact: true });
  await entry.click();
  await page.getByRole('button', { name: 'Сортировка', exact: true }).click();
  await page.getByRole('button', { name: 'Избранные', exact: true }).click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Сортировка', exact: true }).click();
  await page.getByRole('button', { name: 'Сбросить фильтр', exact: true }).first().click();
  await expect(page).not.toHaveURL(/favorite=/);
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
});

test('смена поля поиска сбрасывает выбор закладки', async ({ page }) => {
  await mockSettings(page, [bookmark('one', 'Моя выборка')]);
  await login(page);
  const entry = page.getByRole('button', { name: 'Моя выборка', exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Где искать' }).click();
  await page.getByRole('menuitem', { name: 'По описанию' }).click();
  await expect(entry).toHaveAttribute('aria-pressed', 'false');
});
