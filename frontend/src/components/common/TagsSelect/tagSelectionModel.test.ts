import { describe, expect, it } from 'vitest';
import { createTagOptionSearch } from './tagSelectionModel';

describe('tag option search', () => {
  it('игнорирует результат устаревшего асинхронного запроса', async () => {
    const search = createTagOptionSearch();
    let resolveFirst: (value: string[]) => void;
    const first = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });

    const firstResult = search.run(() => first);
    const secondResult = search.run(() => ['newer']);

    expect(await secondResult).toEqual(['newer']);
    resolveFirst!(['stale']);
    await expect(firstResult).resolves.toBeUndefined();
  });
});
