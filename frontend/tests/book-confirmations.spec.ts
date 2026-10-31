import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';
import { themeIds } from '../src/styles/themes';

const actions = [
  {
    button: 'Удалить',
    title: (title: string) => `Удалить «${title}»?`,
    request: books.req.remove,
  },
  {
    button: 'Сбросить прогресс',
    title: (title: string) => `Сбросить прогресс чтения «${title}»?`,
    request: books.req.resetProgress,
  },
];

for (const theme of themeIds) {
  test(`кнопки подтверждения сохраняют контраст в теме ${theme}`, async ({ page }) => {
    await page.addInitScript((theme) => {
      const key = 'book-hub-preferences';
      const preferences = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...preferences, theme }));
    }, theme);
    await login(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const action of actions) {
      await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
      await page.getByRole('menuitem', { name: action.button, exact: true }).click();
      const dialog = page.getByRole('dialog');
      const button = dialog.getByRole('button', { name: action.button, exact: true });
      for (const hovered of [false, true]) {
        if (hovered) await button.hover();
        else await page.mouse.move(0, 0);
        await expect
          .poll(() =>
            button.evaluate((button) => {
              const content = button.querySelector('span')!;
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = 1;
              const context = canvas.getContext('2d')!;
              const luminance = (color: string) => {
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                return Array.from(context.getImageData(0, 0, 1, 1).data)
                  .slice(0, 3)
                  .reduce((sum, channel, index) => {
                    const value = channel / 255;
                    const linear =
                      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                    return sum + linear * [0.2126, 0.7152, 0.0722][index];
                  }, 0);
              };
              const foreground = luminance(getComputedStyle(content).color);
              const background = luminance(getComputedStyle(button).backgroundColor);
              return (
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05)
              );
            }),
          )
          .toBeGreaterThanOrEqual(4.5);
      }
      await dialog.screenshot({
        path: test.info().outputPath(`${action.request.name}-${theme}.png`),
      });
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    }
  });
}

for (const view of ['Список', 'Сетка']) {
  for (const action of actions) {
    test(`${action.button} (${view}): название книги, отмена и подтверждение`, async ({ page }) => {
      const book = books.items[1];
      const request = action.request(book.id);
      const requests: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'DELETE') requests.push(new URL(request.url()).pathname);
      });
      page.on('dialog', () => {
        throw new Error('Подтверждение должно быть окном приложения');
      });
      await login(page);
      await page.getByRole('button', { name: view, exact: true }).click();
      const trigger = page
        .getByRole('article')
        .nth(1)
        .getByRole('button', { name: 'Действия с книгой', exact: true });
      const open = async () => {
        await trigger.click();
        await page.getByRole('menuitem', { name: action.button, exact: true }).click();
      };
      const dialog = page.getByRole('dialog', { name: action.title(book.title), exact: true });
      await open();
      await expect(dialog.getByRole('heading')).toHaveText(action.title(book.title));
      const cancel = dialog.getByRole('button', { name: 'Отмена', exact: true });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: action.button, exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      await dialog.screenshot({ path: test.info().outputPath('confirmation.png') });
      await cancel.click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await open();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await open();
      await page.mouse.click(5, 5);
      await expect(dialog).toBeHidden();
      expect(requests).toEqual([]);

      await open();
      const response = page.waitForResponse(
        (response) =>
          response.request().method() === request.method &&
          new URL(response.url()).pathname === `/api${request.path}`,
      );
      await dialog.getByRole('button', { name: action.button, exact: true }).click();
      expect((await response).status()).toBe(204);
      await expect(dialog).toBeHidden();
      expect(requests).toEqual([`/api${request.path}`]);
      await expect(
        page.locator(`article a[href="/reader/${books.items[0].id}"]`).first(),
      ).toBeVisible();
    });
  }
}

for (const action of actions) {
  test(`${action.button}: ожидание запроса, ошибка и повтор`, async ({ page }) => {
    const book = books.items[0];
    let finishRequest: () => void = () => undefined;
    const pendingRequest = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    let attempts = 0;
    await page.route(`**/api${action.request(book.id).path}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      attempts += 1;
      if (attempts === 1) {
        await pendingRequest;
        return route.fulfill({
          status: 500,
          json: { code: 'internal_error', message: 'Ошибка', request_id: 'test' },
        });
      }
      return route.fallback();
    });
    await login(page);
    await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
    await page.getByRole('menuitem', { name: action.button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action.title(book.title), exact: true });
    const confirm = dialog.getByRole('button', { name: action.button, exact: true });
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    finishRequest();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();
    expect(attempts).toBe(2);
  });
}

test('длинное название целиком помещается в подтверждениях на мобильном экране', async ({
  page,
  api,
}) => {
  const title = 'ОченьДлинноеНазваниеБезПробелов'.repeat(10);
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], title }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  for (const action of actions) {
    await page.getByRole('button', { name: 'Действия с книгой' }).click();
    await page.getByRole('menuitem', { name: action.button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action.title(title), exact: true });
    await expect(dialog.getByRole('heading')).toHaveText(action.title(title));
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await expect(dialog.getByRole('button', { name: action.button, exact: true })).toBeInViewport();
    await dialog.screenshot({ path: test.info().outputPath(`${action.request.name}-mobile.png`) });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  }
});
