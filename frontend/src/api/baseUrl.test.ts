import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl } from './baseUrl';

describe('API base URL', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, '/api'],
    ['/', '/api'],
    ['/books/', '/books/api'],
    ['books', '/books/api'],
  ])('сохраняет base path %s как %s', (basePath, expected) => {
    vi.stubEnv('VITE_BASE_PATH', basePath);

    expect(getApiBaseUrl()).toBe(expected);
  });
});
