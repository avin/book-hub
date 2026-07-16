import { describe, expect, it } from 'vitest';
import {
  appendUniqueTags,
  mergeRecentTags,
  mergeTagOptions,
  normalizeTags,
  sortTagsByRecent,
} from './tagUtils';

describe('tag utilities', () => {
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
