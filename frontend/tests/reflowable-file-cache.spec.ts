import { expect, test } from './fixtures';
import { login } from './support/api';

const books = [
  { title: 'Война и мир', id: '00000000-0000-0000-0000-000000000101' },
  { title: 'EPUB для проверки', id: '00000000-0000-0000-0000-000000000104' },
];

for (const book of books) {
  test(`${book.title}: возврат во вкладку и восстановление сети не загружают файл заново`, async ({
    page,
  }) => {
    let fileRequests = 0;
    await page.route(`**/api/v1/books/${book.id}/file`, (route) => {
      fileRequests += 1;
      return route.fallback();
    });
    await page.route(`**/api/v1/books/${book.id}/progress`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { progress_percent: 65 } })
        : route.fallback(),
    );
    await login(page);
    await page.getByRole('heading', { name: book.title, exact: true }).getByRole('link').click();
    const article = page.locator('main article');
    await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
    await article.evaluate((element) => element.setAttribute('data-stability-marker', 'original'));
    await page.evaluate(() =>
      window.scrollTo({
        top: (document.documentElement.scrollHeight - innerHeight) * 0.4,
        behavior: 'instant',
      }),
    );

    for (const event of ['visibilitychange', 'online']) {
      const metadataRefetch = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/api/v1/books/${book.id}`,
      );
      await page.evaluate((event) => {
        if (event === 'visibilitychange') {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
          });
          window.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
          });
        } else {
          window.dispatchEvent(new Event('offline'));
        }
        window.dispatchEvent(new Event(event));
      }, event);
      await metadataRefetch;
      // Allow the other queries triggered by this focus/reconnect to complete.
      await page.waitForTimeout(500);
      expect(fileRequests).toBe(1);
      await expect(article).toHaveAttribute('data-stability-marker', 'original');
      expect(
        await page.evaluate(
          () => (scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100,
        ),
      ).toBeCloseTo(40, 0);
    }
  });
}
