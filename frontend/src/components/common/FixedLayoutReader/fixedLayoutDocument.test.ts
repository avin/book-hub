import { describe, expect, it, vi } from 'vitest';
import { createFixedLayoutDocumentLifecycle } from './fixedLayoutDocument';

describe('fixed layout document lifecycle', () => {
  it('освобождает предыдущий и устаревший документ', async () => {
    const release = vi.fn(async () => undefined);
    const documents = [{ id: 'first' }, { id: 'second' }];
    const lifecycle = createFixedLayoutDocumentLifecycle({
      load: vi.fn(async () => documents.shift()!),
      getPages: vi.fn(async () => [{ pageNumber: 1, width: 10, height: 20 }]),
      getOutline: vi.fn(async () => []),
      release,
    });

    await lifecycle.load();
    await lifecycle.load();
    await lifecycle.release();

    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenNthCalledWith(1, { id: 'first' });
    expect(release).toHaveBeenNthCalledWith(2, { id: 'second' });
  });
});
