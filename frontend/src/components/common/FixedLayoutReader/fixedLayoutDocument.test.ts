import { describe, expect, it, vi } from 'vitest';
import { createFixedLayoutReader } from './fixedLayoutReader';

describe('fixed layout reader', () => {
  it('освобождает предыдущий и устаревший документ', async () => {
    const release = vi.fn(async () => undefined);
    const documents = [{ id: 'first' }, { id: 'second' }];
    const reader = createFixedLayoutReader({
      load: vi.fn(async () => documents.shift()!),
      getPages: vi.fn(async () => [{ pageNumber: 1, width: 10, height: 20 }]),
      getOutline: vi.fn(async () => []),
      renderPage: vi.fn(async (_document, pageNumber) => ({ pageNumber })),
      releasePage: vi.fn(async () => undefined),
      search: vi.fn(async (_document, query: string) => query),
      navigate: vi.fn(async (_document, pageNumber: number) => pageNumber),
      release,
    });

    await reader.load();
    await reader.load();
    await reader.release();

    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenNthCalledWith(1, { id: 'first' });
    expect(release).toHaveBeenNthCalledWith(2, { id: 'second' });
  });

  it('передаёт операции активному adapter-у и освобождает устаревший page resource', async () => {
    let resolvePage!: (value: { pageNumber: number }) => void;
    const releasePage = vi.fn(async () => undefined);
    const reader = createFixedLayoutReader({
      load: vi.fn(async () => ({ id: 'document' })),
      getPages: vi.fn(async () => [{ pageNumber: 1, width: 10, height: 20 }]),
      getOutline: vi.fn(async () => []),
      renderPage: vi.fn(
        () =>
          new Promise<{ pageNumber: number }>((resolve) => {
            resolvePage = resolve;
          }),
      ),
      releasePage,
      search: vi.fn(async (_document, query: string) => `match:${query}`),
      navigate: vi.fn(async (_document, pageNumber: number) => pageNumber),
      release: vi.fn(async () => undefined),
    });

    await reader.load();
    await expect(reader.search('needle')).resolves.toBe('match:needle');
    await expect(reader.navigate(2)).resolves.toBe(2);

    const rendering = reader.renderPage(1);
    await reader.release();
    resolvePage({ pageNumber: 1 });

    await expect(rendering).resolves.toBeUndefined();
    expect(releasePage).toHaveBeenCalledWith({ id: 'document' }, 1, { pageNumber: 1 });
  });

  it('освобождает документ, если не удаётся прочитать pages или outline', async () => {
    const document = { id: 'broken' };
    const release = vi.fn(async () => undefined);
    const reader = createFixedLayoutReader({
      load: vi.fn(async () => document),
      getPages: vi.fn(async () => {
        throw new Error('pages failed');
      }),
      getOutline: vi.fn(async () => []),
      renderPage: vi.fn(async (_document, pageNumber) => ({ pageNumber })),
      releasePage: vi.fn(async () => undefined),
      search: vi.fn(async () => ''),
      navigate: vi.fn(async () => undefined),
      release,
    });

    await expect(reader.load()).rejects.toThrow('pages failed');
    expect(release).toHaveBeenCalledWith(document);
  });
});
