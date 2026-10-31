import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';

const description =
  'Роман о судьбах нескольких семей на фоне исторических событий.\nО войне, любви и поиске своего места в мире.';

test('Grid: информация доступна одним кликом, теги сохраняют поиск, Escape возвращает фокус', async ({
  page,
  api,
}) => {
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], description }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await login(page);
  await page.goto('/library?q=Война&tag=роман&sort=title_desc&favorite=favorite');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const card = page.getByRole('article').first();
  const trigger = card.getByRole('button', { name: 'Информация о книге', exact: true });
  await page.mouse.move(0, 0);
  await expect(trigger).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(trigger).toHaveCSS('opacity', '1');
  await page.getByRole('heading', { name: /Ваши книги/ }).hover();
  await trigger.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(trigger).toHaveCSS('opacity', '1');
  await trigger.blur();
  await card.hover();
  const menu = card.getByRole('button', { name: 'Действия с книгой' });
  for (const property of ['backgroundColor', 'color', 'borderRadius', 'width', 'height']) {
    expect(
      await trigger.evaluate(
        (el, prop) => getComputedStyle(el)[prop as keyof CSSStyleDeclaration],
        property,
      ),
    ).toBe(
      await menu.evaluate(
        (el, prop) => getComputedStyle(el)[prop as keyof CSSStyleDeclaration],
        property,
      ),
    );
  }
  await trigger.click();
  const info = page.getByRole('dialog', { name: 'Информация о книге' });
  await expect(info.getByRole('heading')).toHaveText('Война и мир');
  await expect(info.locator('p')).toHaveText(description);
  await expect(info).not.toContainText('Нажмите на тег');
  await expect(info.locator('img')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('grid-quick-info.png') });
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await info.getByRole('button', { name: 'классика', exact: true }).click();
  await expect(info).toBeHidden();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('tag'))
    .toEqual(['роман', 'классика']);
  const url = new URL(page.url());
  expect(url.searchParams.get('q')).toBe('Война');
  expect(url.searchParams.get('sort')).toBe('title_desc');
  expect(url.searchParams.get('favorite')).toBe('favorite');
  await trigger.click();
  await info.getByRole('button', { name: 'классика', exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['роман', 'классика']);
  await trigger.click();
  await page.getByRole('heading', { name: /Ваши книги/ }).click();
  await expect(info).toBeHidden();
  await expect(page).toHaveURL(/\/library/);
});

for (const grid of [false, true]) {
  test(`меню ${grid ? 'Grid' : 'списка'}: первый пункт открывает информацию с обложкой`, async ({
    page,
    api,
  }) => {
    await api.intercept(books.req.list, {
      items: [{ ...books.items[0], description }],
      total: 1,
      limit: 24,
      offset: 0,
    });
    await login(page);
    if (grid) await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const card = page.getByRole('article').first();
    await card.getByRole('button', { name: 'Действия с книгой' }).click();
    await expect(page.getByRole('menuitem').first()).toHaveText('Информация о книге');
    await page.getByRole('menuitem', { name: 'Информация о книге' }).click();
    const info = page.getByRole('dialog', { name: 'Информация о книге' });
    await expect(info.getByRole('heading')).toHaveText('Война и мир');
    await expect(info.locator('p')).toHaveText(description);
    await expect(info).not.toContainText('Нажмите на тег');
    await expect(info.locator('img')).toBeVisible();
    await expect(info.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(info.getByRole('button', { name: 'роман', exact: true })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath('book-info-desktop.png') });
    const cover = info.getByRole('button', { name: 'Показать обложку', exact: true });
    await cover.focus();
    await cover.press('Enter');
    const preview = page.getByRole('dialog', { name: 'Показать обложку', exact: true });
    await expect(preview).toBeVisible();
    await expect(info).toBeHidden();
    await expect(preview.locator('img')).toBeVisible();
    await expect(preview.locator('img')).toHaveAttribute('src', /\/cover$/);
    await page.screenshot({ path: test.info().outputPath('full-cover-from-info.png') });
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(info).toBeVisible();
    await info.getByRole('button', { name: 'Показать обложку', exact: true }).click();
    await expect(preview).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(preview).toBeHidden();
    await expect(info).toBeVisible();
    await info.getByRole('button', { name: 'классика', exact: true }).click();
    await expect(info).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.getAll('tag')).toEqual(['классика']);
  });
}

test('мобильный Grid: длинное название, много тегов, тёмная тема и отсутствующая обложка', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api.intercept(books.req.list, {
    items: [
      {
        ...books.items[0],
        description,
        title:
          'Длинное название книги о проектировании удобных интерфейсов и организации личной библиотеки',
        tags: [
          'очень-длинный-тег-без-пробелов-для-проверки-переноса',
          ...Array.from({ length: 18 }, (_, i) => `Тег ${i + 1}`),
        ],
      },
    ],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await page.route('**/api/v1/books/*/cover?*', (route) => route.fulfill({ status: 404 }));
  await login(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark-ink'));
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const card = page.getByRole('article').first();
  await card.getByRole('button', { name: 'Информация о книге', exact: true }).click();
  const info = page.getByRole('dialog');
  const bounds = await info.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(info.locator('p')).toHaveText(description);
  await page.screenshot({ path: test.info().outputPath('quick-info-mobile-dark.png') });
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Действия с книгой' }).click();
  await page.getByRole('menuitem', { name: 'Информация о книге' }).click();
  await expect(info.locator('img')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('book-info-mobile-dark.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await info.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(info).toBeHidden();
});

for (const width of [390, 1280]) {
  test(`длинные теги обрезаются с многоточием без переноса при ширине ${width}`, async ({
    page,
    api,
  }) => {
    const longTags = ['длинный тег с пробелами '.repeat(3).slice(0, 64), 'ш'.repeat(64)];
    await page.setViewportSize({ width, height: 844 });
    await api.intercept(books.req.list, {
      items: [{ ...books.items[0], tags: longTags }],
      total: 1,
      limit: 24,
      offset: 0,
    });
    await login(page);
    await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const card = page.getByRole('article').first();
    const info = page.getByRole('dialog', { name: 'Информация о книге', exact: true });
    for (const compact of [true, false]) {
      if (compact) {
        await card.getByRole('button', { name: 'Информация о книге', exact: true }).click();
      } else {
        await card.getByRole('button', { name: 'Действия с книгой', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Информация о книге', exact: true }).click();
      }
      for (const tag of longTags) {
        const button = info.getByRole('button', { name: tag, exact: true });
        await expect(button).toHaveAttribute('title', tag);
        await expect(button).toHaveCSS('height', '32px');
        const text = button.locator('span').last();
        await expect(text).toHaveCSS('white-space', 'nowrap');
        await expect(text).toHaveCSS('text-overflow', 'ellipsis');
        await expect(text).toHaveCSS('height', '20px');
        if (tag === longTags[1]) {
          expect(await text.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
            true,
          );
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await info.screenshot({
        path: test.info().outputPath(`long-tags-${compact ? 'panel' : 'dialog'}-${width}.png`),
      });
      if (compact) await page.keyboard.press('Escape');
    }
    await info.getByRole('button', { name: longTags[0], exact: true }).click();
    await expect(info).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.getAll('tag')).toEqual([longTags[0]]);
  });
}

test('книга без тегов показывает пустое состояние', async ({ page, api }) => {
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags: [] }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await login(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await page
    .getByRole('article')
    .getByRole('button', { name: 'Информация о книге', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Без тегов');
});

test('широкий Grid: длинное описание и теги используют свободную ширину без лишней прокрутки', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1800, height: 960 });
  const longDescription =
    'Plura mihi bona sunt, inclinet, amari petere vellent. Ab illo tempore, ab est sed memorabili. Ullamco laboris nisi ut aliquid ex ea commodi consequat. Quae vero auctore tractata ab fiducia dicuntur. At nos hinc posthac, sitientis piros Afros. '.repeat(
      2,
    );
  await api.intercept(books.req.list, {
    items: Array.from({ length: 6 }, (_, i) => ({
      ...books.items[0],
      id: `book-${i}`,
      title: `Книга ${i + 1}`,
      description: longDescription,
      tags: [
        'magazine',
        'хакер',
        'еще один непонятный тег',
        'и еще один тег',
        'какая-то странная книга',
        'интерфейсы',
        'разработка',
        'чтение',
        'библиотека',
        'программирование',
      ],
    })),
    total: 6,
    limit: 24,
    offset: 0,
  });
  await login(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  for (const card of [page.getByRole('article').first(), page.getByRole('article').last()]) {
    await card.getByRole('button', { name: 'Информация о книге', exact: true }).click();
    const info = page.getByRole('dialog');
    await expect(info.locator('p')).toHaveText(longDescription.trim());
    const bounds = await info.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(620);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1800);
    const overflow = await info.evaluate((el) => {
      const panel = el.parentElement!;
      return {
        vertical: panel.scrollHeight > panel.clientHeight,
        horizontal: panel.scrollWidth > panel.clientWidth,
      };
    });
    expect(overflow).toEqual({ vertical: false, horizontal: false });
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          `wide-info-${(await card.getByRole('link').getAttribute('href')) === '/reader/book-0' ? 'first' : 'last'}.png`,
        ),
    });
    await page.keyboard.press('Escape');
  }
});
