import { expect, type Page, type Route } from '@playwright/test';
import * as account from '../mocks/account';
import * as auth from '../mocks/auth';
import * as books from '../mocks/books';

type RequestDefinition = { method: string; path: string };
type ResponseBody = unknown;
type Book = (typeof books.items)[number];

function json(route: Route, body: ResponseBody, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function responseFor(route: Route, body: ResponseBody, status = 200) {
  if (status === 204) {
    return route.fulfill({ status });
  }

  return json(route, body, status);
}

export function createApiMocks(page: Page) {
  const state = {
    authenticated: false,
    books: structuredClone(books.items),
    progress: 0,
  };
  const unexpected: string[] = [];

  const intercept = async (request: RequestDefinition, body: ResponseBody, status = 200) => {
    await page.route(`**/api${request.path}`, (route) => {
      if (route.request().method() !== request.method) {
        return route.fallback();
      }

      return responseFor(route, body, status);
    });
  };

  const mockDefaults = async () => {
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, '');
      const method = request.method();

      if (path === auth.req.csrf.path && method === auth.req.csrf.method)
        return json(route, auth.csrf);
      if (path === auth.req.currentUser.path && method === auth.req.currentUser.method) {
        return json(route, state.authenticated ? auth.user : null);
      }
      if (path === auth.req.login.path && method === auth.req.login.method) {
        state.authenticated = true;
        return json(route, auth.login);
      }
      if (path === auth.req.register.path && method === auth.req.register.method)
        return json(route, auth.registration, 201);
      if (path === auth.req.logout.path && method === auth.req.logout.method) {
        state.authenticated = false;
        return responseFor(route, undefined, 204);
      }
      if (path === books.req.tags.path && method === books.req.tags.method)
        return json(route, books.tags);
      if (path === books.req.list.path && method === books.req.list.method)
        return mockBookList(route);

      const match = path.match(/^\/v1\/books\/([^/]+)(?:\/(cover|file|progress))?$/);
      if (match) return mockBookResource(route, match[1], match[2]);
      if (path === books.req.upload.path && method === books.req.upload.method)
        return json(route, newBook(), 201);
      if (path === account.req.settings.path && method === account.req.settings.method)
        return json(route, account.settings);
      if (path === account.req.updateSettings.path && method === account.req.updateSettings.method)
        return json(route, request.postDataJSON());
      if (path === account.req.password.path && method === account.req.password.method)
        return responseFor(route, undefined, 204);
      if (path === account.req.resetProgress.path && method === account.req.resetProgress.method)
        return responseFor(route, undefined, 204);

      unexpected.push(`${method} ${path}`);
      return json(route, { message: 'Unmocked API request' }, 500);
    });
  };

  const mockBookList = (route: Route) => {
    const query = route.request().postDataJSON() as {
      q?: string;
      favorite?: boolean | null;
      tags?: string[];
    };
    const filtered = state.books.filter(
      (book) =>
        (!query.q || book.title.toLowerCase().includes(query.q.toLowerCase())) &&
        (query.favorite === null ||
          query.favorite === undefined ||
          book.favorite === query.favorite) &&
        (!query.tags?.length || query.tags.every((tag) => book.tags.includes(tag))),
    );
    return json(route, { items: filtered, total: filtered.length, limit: 24, offset: 0 });
  };

  const mockBookResource = (route: Route, bookId: string, resource?: string) => {
    const book =
      state.books.find((item) => item.id === decodeURIComponent(bookId)) ?? state.books[0];
    const method = route.request().method();

    if (resource === 'file' && method === 'GET') {
      const body = book.format === 'pdf' ? books.pdfFile : books.fb2File;
      const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/xml';
      const download = new URL(route.request().url()).searchParams.get('download') === '1';
      const headers: Record<string, string> = {};
      if (download) {
        headers['Content-Disposition'] = `attachment; filename="${book.title}.${book.format}"`;
      }

      return route.fulfill({ status: 200, contentType, headers, body });
    }
    if (resource === 'cover' && method === 'GET')
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='120'><rect width='80' height='120' fill='orange'/></svg>",
      });
    if (resource === 'progress' && method === 'GET')
      return json(route, { progress_percent: state.progress });
    if (resource === 'progress' && method === 'PUT') {
      state.progress = (
        route.request().postDataJSON() as { progress_percent: number }
      ).progress_percent;
      return json(route, { progress_percent: state.progress });
    }
    if (resource === 'progress' && method === 'DELETE') return responseFor(route, undefined, 204);
    if (!resource && method === 'GET')
      return json(route, { ...book, progress_percent: state.progress });
    if (!resource && method === 'PATCH') {
      Object.assign(book, route.request().postDataJSON() as Partial<Book>);
      return json(route, book);
    }
    if (resource === 'cover' && (method === 'PUT' || method === 'DELETE'))
      return responseFor(route, undefined, 204);
    if (!resource && method === 'DELETE') {
      state.books = state.books.filter((item) => item.id !== book.id);
      return responseFor(route, undefined, 204);
    }

    return json(route, { message: 'Unsupported mocked book operation' }, 500);
  };

  const newBook = () => ({ ...state.books[0], id: '00000000-0000-0000-0000-000000000199' });

  return {
    intercept,
    mockDefaults,
    assertNoUnexpectedRequests: () =>
      expect(
        unexpected,
        `Обнаружены незамокированные API-запросы: ${unexpected.join(', ')}`,
      ).toEqual([]),
  };
}

export async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#login').fill('reader');
  await page.locator('#password').fill('secret');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/library$/);
}
