import { describe, expect, it } from 'vitest';
import {
  appendUniqueTags,
  mergeRecentTags,
  mergeTagOptions,
  normalizeTags,
  sortTagsByRecent,
} from './tagUtils';

describe('tag utilities', () => {
  it('соблюдает серверные ограничения: 64 Unicode-символа и 50 тегов при добавлении', () => {
    expect(normalizeTags(['🙂'.repeat(65)])).toEqual(['🙂'.repeat(64)]);
    expect(
      appendUniqueTags(
        Array.from({ length: 49 }, (_, i) => `tag-${i}`),
        ['one', 'two'],
      ),
    ).toHaveLength(50);
    expect(mergeTagOptions(Array.from({ length: 60 }, (_, i) => `tag-${i}`))).toHaveLength(60);
  });
  it('нормализует и дедуплицирует теги, сохраняя первый порядок', () => {
    expect(normalizeTags([' Fantasy ', 'fantasy', '', 'History', ' history '])).toEqual([
      'fantasy',
      'history',
    ]);
    expect(appendUniqueTags(['fiction', 'history'], ['history', 'science'])).toEqual([
      'fiction',
      'history',
      'science',
    ]);
    expect(appendUniqueTags([' Fiction '], ['fiction', 'HISTORY', ' history ', ''])).toEqual([
      'fiction',
      'history',
    ]);
  });

  it('сливает доступные теги в прежнем отсортированном порядке', () => {
    expect(mergeTagOptions(['zeta', 'alpha'], ['alpha', 'beta'], ['gamma'])).toEqual([
      'alpha',
      'beta',
      'gamma',
      'zeta',
    ]);
  });

  it('поднимает недавние теги в начало списка и ограничивает историю', () => {
    expect(sortTagsByRecent(['alpha', 'beta', 'gamma'], ['gamma', 'missing', 'beta'])).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);
    expect(mergeRecentTags(['old', 'ONE', 'one'], [' two ', 'one'], 3)).toEqual([
      'one',
      'two',
      'old',
    ]);
  });
});
