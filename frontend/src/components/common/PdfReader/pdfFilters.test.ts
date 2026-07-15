import { describe, expect, it } from 'vitest';
import {
  defaultFixedLayoutFilterChain,
  fixedLayoutFilterChainKey,
  hasEnabledFixedLayoutFilters,
  invertFilterFromFixedLayoutChain,
  normalizedFixedLayoutFilterChain,
  sanitizeFixedLayoutFilterChain,
  textEnhancementFilterFromFixedLayoutChain,
} from '../FixedLayoutReader/fixedLayoutFilters';

describe('fixedLayoutFilters', () => {
  it('нормализует старую цепочку, ограничивает значения и добавляет пропущенные фильтры', () => {
    const chain = sanitizeFixedLayoutFilterChain([
      {
        id: 'enhanceText',
        enabled: true,
        strokeWidth: 5,
        threshold: -2,
        contrast: 1.5,
        grayLevels: 8.6,
        toneShift: 3,
      },
      { id: 'invert', enabled: true, strength: -1 },
      { id: 'invert', enabled: false, strength: 0.5 },
      { id: 'unknown', enabled: true },
    ]);

    expect(chain).toHaveLength(6);
    expect(textEnhancementFilterFromFixedLayoutChain(chain!)).toMatchObject({
      enabled: true,
      strokeWidth: 2,
      threshold: 0,
      contrast: 1.5,
      grayLevels: 9,
      toneShift: 1,
    });
    expect(invertFilterFromFixedLayoutChain(chain!)).toMatchObject({ enabled: true, strength: 0 });
  });

  it('отклоняет невалидную цепочку и создаёт независимые значения по умолчанию', () => {
    expect(sanitizeFixedLayoutFilterChain({})).toBeUndefined();
    expect(sanitizeFixedLayoutFilterChain([])).toBeUndefined();

    const first = defaultFixedLayoutFilterChain();
    const second = normalizedFixedLayoutFilterChain(undefined);
    first[0].enabled = true;

    expect(second[0].enabled).toBe(false);
    expect(hasEnabledFixedLayoutFilters(first)).toBe(true);
    expect(hasEnabledFixedLayoutFilters(second)).toBe(false);
    expect(fixedLayoutFilterChainKey(second)).toBe(JSON.stringify(second));
  });
});
