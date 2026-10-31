import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

const readerBooks = [
  books.items[0],
  books.items[1],
  books.items[3],
  { ...books.items[0], id: '00000000-0000-0000-0000-000000000105', format: 'djvu' },
];

for (const book of readerBooks) {
  test(`информация о книге ${book.format}: компактная кнопка и переход по тегу`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const description = 'Описание книги для проверки информации в читалке.';
    await api.intercept({ method: 'GET', path: `/v1/books/${book.id}` }, { ...book, description });
    if (book.format === 'djvu') {
      const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
      await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
        route.fulfill({ status: 200, contentType: 'image/vnd.djvu', body: file }),
      );
    }
    await login(page);
    await page.goto(`/reader/${book.id}`);
    const header = page.getByTestId('reader-floating-header');
    await page.mouse.move(0, 0);
    await expect(header).toHaveAttribute('data-visible', 'true');

    const infoButton = header.getByRole('button', { name: 'Информация о книге', exact: true });
    await expect(infoButton).toHaveCSS('width', '32px');
    await expect(infoButton).toHaveCSS('height', '32px');
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await page.mouse.move(0, 0);
      const titleBox = await header.getByText(book.title, { exact: true }).boundingBox();
      const buttonBox = await infoButton.boundingBox();
      expect(titleBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      const gap = buttonBox!.x - (titleBox!.x + titleBox!.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(8);
      expect(await header.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width);
      await header.screenshot({ path: test.info().outputPath(`reader-info-header-${width}.png`) });
    }

    await infoButton.click();
    const dialog = page.getByRole('dialog', { name: 'Информация о книге', exact: true });
    await expect(dialog.getByRole('heading')).toHaveText(book.title);
    await expect(dialog).toContainText(description);
    await dialog.screenshot({ path: test.info().outputPath('reader-info-dialog-mobile.png') });

    const filteredRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/books/query',
    );
    await dialog.getByRole('button', { name: book.tags[0], exact: true }).click();
    await expect(page).toHaveURL(`/library?${new URLSearchParams({ tag: book.tags[0] })}`);
    await expect(dialog).toHaveCount(0);
    expect((await filteredRequest).postDataJSON()).toMatchObject({ tags: [book.tags[0]] });
  });
}

test('информация в читалке: закрытие, полная обложка и сохранение фильтров без дубликатов', async ({
  page,
}) => {
  await login(page);
  const params = new URLSearchParams({
    q: 'Война',
    tag: 'роман',
    sort: 'title_desc',
    favorite: 'favorite',
  });
  await page.goto(`/library?${params}`);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  const header = page.getByTestId('reader-floating-header');
  const infoButton = header.getByRole('button', { name: 'Информация о книге', exact: true });
  await page.mouse.move(0, 0);
  await infoButton.click();
  const dialog = page.getByRole('dialog', { name: 'Информация о книге', exact: true });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(infoButton).toBeFocused();
  await page.mouse.move(0, 0);
  await infoButton.click();
  await dialog.getByRole('button', { name: 'Показать обложку', exact: true }).click();
  const cover = page.getByRole('dialog', { name: 'Показать обложку', exact: true });
  await expect(cover.locator('img')).toHaveAttribute('src', /\/cover$/);
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(cover).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.mouse.move(0, 0);
  await infoButton.click();
  await dialog.getByRole('button', { name: 'роман', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/library');
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(Object.fromEntries(params));
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['роман']);

  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  await page.mouse.move(0, 0);
  await infoButton.click();
  await dialog.getByRole('button', { name: 'классика', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL((url) => url.pathname === '/library');
  params.append('tag', 'классика');
  expect([...new URL(page.url()).searchParams].sort()).toEqual([...params].sort());
});
