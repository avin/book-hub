import { describe, expect, it } from 'vitest';
import {
  defaultPdfFilterChain,
  hasEnabledPdfFilters,
  invertFilterFromChain,
  normalizedPdfFilterChain,
  pdfFilterChainKey,
  sanitizePdfFilterChain,
  textEnhancementFilterFromChain,
} from './pdfFilters';

describe('pdfFilters', () => {
  it('нормализует старую цепочку, ограничивает значения и добавляет пропущенные фильтры', () => {
    const chain = sanitizePdfFilterChain([
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
    expect(textEnhancementFilterFromChain(chain!)).toMatchObject({
      enabled: true,
      strokeWidth: 2,
      threshold: 0,
      contrast: 1.5,
      grayLevels: 9,
      toneShift: 1,
    });
    expect(invertFilterFromChain(chain!)).toMatchObject({ enabled: true, strength: 0 });
  });

  it('отклоняет невалидную цепочку и создаёт независимые значения по умолчанию', () => {
    expect(sanitizePdfFilterChain({})).toBeUndefined();
    expect(sanitizePdfFilterChain([])).toBeUndefined();

    const first = defaultPdfFilterChain();
    const second = normalizedPdfFilterChain(undefined);
    first[0].enabled = true;

    expect(second[0].enabled).toBe(false);
    expect(hasEnabledPdfFilters(first)).toBe(true);
    expect(hasEnabledPdfFilters(second)).toBe(false);
    expect(pdfFilterChainKey(second)).toBe(JSON.stringify(second));
  });
});
