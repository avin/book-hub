import { describe, expect, it } from 'vitest';
import {
  createPdfPageRenderPlan,
  cssPointToPdf,
  limitPdfRenderTiles,
  pdfMaxTileDimension,
  pdfMaxTilePixels,
  pdfPointToCss,
  pdfRectToCss,
} from './pdfRenderPlan';

function tallPlan(options?: { viewportTop?: number; pixelRatio?: number; displayWidth?: number }) {
  const displayWidth = options?.displayWidth ?? 1400;
  const displayHeight = displayWidth * (12_800 / 768.96);

  return createPdfPageRenderPlan({
    pageNumber: 8,
    pdfWidth: 768.96,
    pdfHeight: 12_800,
    displayWidth,
    displayHeight,
    pageViewportRect: {
      origin: { x: 0, y: -(options?.viewportTop ?? 0) },
      size: { width: displayWidth, height: displayHeight },
    },
    viewportWidth: 1400,
    viewportHeight: 900,
    pixelRatio: options?.pixelRatio ?? 1,
  });
}

describe('PDF render plan', () => {
  it('использует один tile для обычной страницы, помещающейся в budget', () => {
    const plan = createPdfPageRenderPlan({
      pageNumber: 1,
      pdfWidth: 360,
      pdfHeight: 520,
      displayWidth: 720,
      displayHeight: 1040,
      pageViewportRect: {
        origin: { x: 0, y: 0 },
        size: { width: 720, height: 1040 },
      },
      viewportWidth: 720,
      viewportHeight: 1040,
      pixelRatio: 1,
    });

    expect(plan.tiles).toHaveLength(1);
    expect(plan.tiles[0].pdfRect).toEqual({
      origin: { x: 0, y: 0 },
      size: { width: 360, height: 520 },
    });
  });

  it.each([1, 2])('ограничивает размеры tall-page tiles при DPR %s', (pixelRatio) => {
    const plan = tallPlan({ pixelRatio, viewportTop: 10_000 });

    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const tile of plan.tiles) {
      expect(tile.outputWidth).toBeLessThanOrEqual(pdfMaxTileDimension);
      expect(tile.outputHeight).toBeLessThanOrEqual(pdfMaxTileDimension);
      expect(tile.pixelCount).toBeLessThanOrEqual(pdfMaxTilePixels);
    }
  });

  it.each([0, 10_000, 22_000])('покрывает viewport и обрезает overscan у границ (%s)', (top) => {
    const plan = tallPlan({ viewportTop: top, pixelRatio: 2 });
    const pageHeight = plan.displayHeight;

    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const tile of plan.tiles) {
      expect(tile.coreCssRect.origin.x).toBeGreaterThanOrEqual(0);
      expect(tile.coreCssRect.origin.y).toBeGreaterThanOrEqual(0);
      expect(tile.coreCssRect.origin.x + tile.coreCssRect.size.width).toBeLessThanOrEqual(1400);
      expect(tile.coreCssRect.origin.y + tile.coreCssRect.size.height).toBeLessThanOrEqual(
        pageHeight,
      );
    }
  });

  it('создаёт соседние core rects без дыр и overlap', () => {
    const plan = tallPlan({ viewportTop: 9000, pixelRatio: 2 });
    const firstColumn = plan.tiles
      .filter((tile) => tile.coreCssRect.origin.x === 0)
      .sort((left, right) => left.coreCssRect.origin.y - right.coreCssRect.origin.y);

    for (let index = 1; index < firstColumn.length; index += 1) {
      const previous = firstColumn[index - 1].coreCssRect;
      const current = firstColumn[index].coreCssRect;
      expect(previous.origin.y + previous.size.height).toBeCloseTo(current.origin.y, 8);

      const previousRender = firstColumn[index - 1].renderCssRect;
      const currentRender = firstColumn[index].renderCssRect;
      const renderOverlapDevicePixels =
        (previousRender.origin.y + previousRender.size.height - currentRender.origin.y) * 2;
      expect(renderOverlapDevicePixels).toBeCloseTo(8, 8);
    }
  });

  it('меняет ключ при resize, zoom и DPR', () => {
    const original = tallPlan({ displayWidth: 1400, pixelRatio: 1 });
    const resized = tallPlan({ displayWidth: 1200, pixelRatio: 1 });
    const retina = tallPlan({ displayWidth: 1400, pixelRatio: 2 });

    expect(resized.key).not.toBe(original.key);
    expect(retina.key).not.toBe(original.key);
  });

  it('взаимно обращает PDF и CSS координаты в top-left contract', () => {
    const pdfSize = { width: 768.96, height: 12_800 };
    const cssSize = { width: 1400, height: 23_303.97 };
    const point = { x: 177.25, y: 10_420.5 };

    expect(cssPointToPdf(pdfPointToCss(point, pdfSize, cssSize), pdfSize, cssSize)).toEqual(
      expect.objectContaining({ x: expect.closeTo(point.x, 8), y: expect.closeTo(point.y, 8) }),
    );
  });

  it('сохраняет rotation-normalized геометрию без перестановки осей', () => {
    const rect = {
      origin: { x: 100, y: 20 },
      size: { width: 200, height: 80 },
    };
    const cssRect = pdfRectToCss(rect, { width: 520, height: 360 }, { width: 1040, height: 720 });

    expect(cssRect).toEqual({
      origin: { x: 200, y: 40 },
      size: { width: 400, height: 160 },
    });
  });

  it('ограничивает суммарный active pixel budget', () => {
    const plan = tallPlan({ viewportTop: 10_000, pixelRatio: 2 });
    const limited = limitPdfRenderTiles(plan.tiles, pdfMaxTilePixels * 2);

    expect(limited.reduce((sum, tile) => sum + tile.pixelCount, 0)).toBeLessThanOrEqual(
      pdfMaxTilePixels * 2,
    );
  });
});
