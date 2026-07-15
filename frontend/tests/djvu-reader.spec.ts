import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import * as bookMocks from './mocks/books';
import { login } from './support/api';

const djvuBookId = '00000000-0000-0000-0000-000000000105';

test('читатель DJVU отрисовывает страницу в браузере', async ({ page }) => {
  const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
  await login(page);
  await page.route(`**/api/v1/books/${djvuBookId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...bookMocks.items[0], id: djvuBookId, format: 'djvu' }),
    }),
  );
  await page.route(`**/api/v1/books/${djvuBookId}/file`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/vnd.djvu', body: file }),
  );
  await page.goto(`/reader/${djvuBookId}`);

  const canvas = page.locator('[data-page-number="1"] canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => canvas.evaluate((element) => element.width > 0 && element.height > 0))
    .toBe(true);
});

test('читатель DJVU завершает Worker при размонтировании', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__bookHubTerminatedWorkers', {
      configurable: true,
      value: 0,
      writable: true,
    });
  });
  await page.route('**/djvujs-assets/djvu.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();

    await route.fulfill({
      response,
      body: [
        source,
        ';(() => {',
        '  const OriginalWorker = window.DjVu.Worker;',
        '  window.DjVu.Worker = class extends OriginalWorker {',
        '    constructor(...args) {',
        '      super(...args);',
        '      const terminate = this.worker.terminate.bind(this.worker);',
        '      this.worker.terminate = (...terminateArgs) => {',
        '        window.__bookHubTerminatedWorkers += 1;',
        '        return terminate(...terminateArgs);',
        '      };',
        '    }',
        '  };',
        '})();',
      ].join('\n'),
    });
  });

  const file = await readFile(new URL('./fixtures/djvu/sample2.djvu', import.meta.url));
  await login(page);
  await page.route(`**/api/v1/books/${djvuBookId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...bookMocks.items[0], id: djvuBookId, format: 'djvu' }),
    }),
  );
  await page.route(`**/api/v1/books/${djvuBookId}/file`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/vnd.djvu', body: file }),
  );
  await page.goto(`/reader/${djvuBookId}`);
  await expect(page.locator('[data-page-number="1"] canvas').first()).toBeVisible({
    timeout: 30_000,
  });

  await page.mouse.move(0, 0);
  await page.getByRole('link', { name: 'Библиотека' }).click();
  await expect(page).toHaveURL('/library');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __bookHubTerminatedWorkers: number }).__bookHubTerminatedWorkers,
      ),
    )
    .toBeGreaterThan(0);
});
