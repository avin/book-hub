import { describe, expect, it } from 'vitest';
import {
  pdfPageTileCount,
  pdfTileBounds,
  pdfTileDistanceToZone,
  pdfTileRangeInZone,
} from './pdfPageTiles';

describe('pdfPageTiles', () => {
  it('не делит обычные страницы и делит длинные на полосы', () => {
    expect(pdfPageTileCount(1600)).toBe(1);
    expect(pdfPageTileCount(2048)).toBe(1);
    expect(pdfPageTileCount(2049)).toBe(3);
    expect(pdfPageTileCount(18108)).toBe(18);
  });

  it('покрывает всю страницу полосами с перекрытием снизу', () => {
    const tiles = [0, 1, 2].map((index) => pdfTileBounds(index, 3, 1000, 2));

    expect(tiles).toEqual([
      { deviceTop: 0, deviceHeight: 335 },
      { deviceTop: 333, deviceHeight: 335 },
      { deviceTop: 666, deviceHeight: 334 },
    ]);
    expect(pdfTileBounds(0, 1, 1000, 2)).toEqual({ deviceTop: 0, deviceHeight: 1000 });
  });

  it('находит полосы, пересекающие зону отрисовки', () => {
    expect(pdfTileRangeInZone(-5000, 10000, 10, 0, 1200)).toEqual({ first: 5, last: 6 });
    expect(pdfTileRangeInZone(500, 10000, 10, 0, 1200)).toEqual({ first: 0, last: 0 });
    expect(pdfTileRangeInZone(-20000, 10000, 10, 0, 1200)).toBeUndefined();
    expect(pdfTileRangeInZone(2000, 10000, 10, 0, 1200)).toBeUndefined();
  });

  it('считает расстояние полосы до зоны', () => {
    expect(pdfTileDistanceToZone(-5000, 10000, 10, 5, 0, 1200)).toBe(0);
    expect(pdfTileDistanceToZone(-5000, 10000, 10, 3, 0, 1200)).toBe(1000);
    expect(pdfTileDistanceToZone(-5000, 10000, 10, 8, 0, 1200)).toBe(1800);
  });
});
