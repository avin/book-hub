import type { Rect } from '@embedpdf/models';

export const pdfMaxTilePixels = 4_194_304;
export const pdfMaxTileDimension = 4096;
export const pdfMaxActivePixels = 33_554_432;
export const pdfFilterSamplingOverlap = 4;

export type PdfRenderTile = {
  key: string;
  pageNumber: number;
  coreCssRect: Rect;
  renderCssRect: Rect;
  pdfRect: Rect;
  outputWidth: number;
  outputHeight: number;
  pixelCount: number;
  priority: 0 | 1 | 2;
  distanceFromViewportCenter: number;
};

export type PdfPageRenderPlan = {
  key: string;
  pageNumber: number;
  displayWidth: number;
  displayHeight: number;
  pixelRatio: number;
  tiles: PdfRenderTile[];
};

type PageRenderPlanInput = {
  pageNumber: number;
  pdfWidth: number;
  pdfHeight: number;
  displayWidth: number;
  displayHeight: number;
  pageViewportRect: Rect;
  viewportWidth: number;
  viewportHeight: number;
  pixelRatio: number;
  overscanX?: number;
  overscanY?: number;
  maxTilePixels?: number;
  maxTileDimension?: number;
  samplingOverlap?: number;
};

function end(rect: Rect, axis: 'x' | 'y') {
  return rect.origin[axis] + (axis === 'x' ? rect.size.width : rect.size.height);
}

function intersects(a: Rect, b: Rect) {
  return (
    a.origin.x < end(b, 'x') &&
    end(a, 'x') > b.origin.x &&
    a.origin.y < end(b, 'y') &&
    end(a, 'y') > b.origin.y
  );
}

function contains(rect: Rect, x: number, y: number) {
  return x >= rect.origin.x && x <= end(rect, 'x') && y >= rect.origin.y && y <= end(rect, 'y');
}

function rectIntersection(a: Rect, b: Rect): Rect | undefined {
  const left = Math.max(a.origin.x, b.origin.x);
  const top = Math.max(a.origin.y, b.origin.y);
  const right = Math.min(end(a, 'x'), end(b, 'x'));
  const bottom = Math.min(end(a, 'y'), end(b, 'y'));

  if (right <= left || bottom <= top) {
    return undefined;
  }

  return {
    origin: { x: left, y: top },
    size: { width: right - left, height: bottom - top },
  };
}

function stableNumber(value: number) {
  return Number(value.toFixed(4));
}

export function pdfPointToCss(
  point: { x: number; y: number },
  pdfSize: { width: number; height: number },
  cssSize: { width: number; height: number },
) {
  return {
    x: (point.x / pdfSize.width) * cssSize.width,
    y: (point.y / pdfSize.height) * cssSize.height,
  };
}

export function cssPointToPdf(
  point: { x: number; y: number },
  pdfSize: { width: number; height: number },
  cssSize: { width: number; height: number },
) {
  return {
    x: (point.x / cssSize.width) * pdfSize.width,
    y: (point.y / cssSize.height) * pdfSize.height,
  };
}

export function cssRectToPdf(
  rect: Rect,
  pdfSize: { width: number; height: number },
  cssSize: { width: number; height: number },
): Rect {
  const origin = cssPointToPdf(rect.origin, pdfSize, cssSize);
  const farCorner = cssPointToPdf({ x: end(rect, 'x'), y: end(rect, 'y') }, pdfSize, cssSize);

  return {
    origin,
    size: { width: farCorner.x - origin.x, height: farCorner.y - origin.y },
  };
}

export function pdfRectToCss(
  rect: Rect,
  pdfSize: { width: number; height: number },
  cssSize: { width: number; height: number },
): Rect {
  const origin = pdfPointToCss(rect.origin, pdfSize, cssSize);
  const farCorner = pdfPointToCss({ x: end(rect, 'x'), y: end(rect, 'y') }, pdfSize, cssSize);

  return {
    origin,
    size: { width: farCorner.x - origin.x, height: farCorner.y - origin.y },
  };
}

export function createPdfPageRenderPlan(input: PageRenderPlanInput): PdfPageRenderPlan {
  const pixelRatio = Math.max(1, input.pixelRatio);
  const overlap = Math.max(0, input.samplingOverlap ?? pdfFilterSamplingOverlap);
  const maxPixels = input.maxTilePixels ?? pdfMaxTilePixels;
  const maxDimension = input.maxTileDimension ?? pdfMaxTileDimension;
  const maxCoreDeviceSize = Math.max(
    1,
    Math.min(maxDimension - overlap * 2, Math.floor(Math.sqrt(maxPixels)) - overlap * 2),
  );
  const coreCssSize = maxCoreDeviceSize / pixelRatio;
  const pageBounds: Rect = {
    origin: { x: 0, y: 0 },
    size: { width: input.displayWidth, height: input.displayHeight },
  };
  const viewportInPage: Rect = {
    origin: { x: -input.pageViewportRect.origin.x, y: -input.pageViewportRect.origin.y },
    size: { width: input.viewportWidth, height: input.viewportHeight },
  };
  const visibleRect = rectIntersection(pageBounds, viewportInPage);
  const activeRect = rectIntersection(pageBounds, {
    origin: {
      x: viewportInPage.origin.x - (input.overscanX ?? input.viewportWidth),
      y: viewportInPage.origin.y - (input.overscanY ?? input.viewportHeight),
    },
    size: {
      width: viewportInPage.size.width + (input.overscanX ?? input.viewportWidth) * 2,
      height: viewportInPage.size.height + (input.overscanY ?? input.viewportHeight) * 2,
    },
  });
  const fullOutputWidth = Math.round(input.displayWidth * pixelRatio);
  const fullOutputHeight = Math.round(input.displayHeight * pixelRatio);
  const fullPageFits =
    fullOutputWidth <= maxDimension &&
    fullOutputHeight <= maxDimension &&
    fullOutputWidth * fullOutputHeight <= maxPixels;
  const tiles: PdfRenderTile[] = [];

  if (activeRect) {
    const tileArea = fullPageFits ? pageBounds : activeRect;
    const startColumn = fullPageFits ? 0 : Math.floor(tileArea.origin.x / coreCssSize);
    const endColumn = fullPageFits
      ? 0
      : Math.floor(Math.max(tileArea.origin.x, end(tileArea, 'x') - 0.0001) / coreCssSize);
    const startRow = fullPageFits ? 0 : Math.floor(tileArea.origin.y / coreCssSize);
    const endRow = fullPageFits
      ? 0
      : Math.floor(Math.max(tileArea.origin.y, end(tileArea, 'y') - 0.0001) / coreCssSize);
    const viewportCenter = {
      x: viewportInPage.origin.x + viewportInPage.size.width / 2,
      y: viewportInPage.origin.y + viewportInPage.size.height / 2,
    };

    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        const coreCssRect: Rect = fullPageFits
          ? pageBounds
          : {
              origin: { x: column * coreCssSize, y: row * coreCssSize },
              size: {
                width: Math.min(coreCssSize, input.displayWidth - column * coreCssSize),
                height: Math.min(coreCssSize, input.displayHeight - row * coreCssSize),
              },
            };
        const overlapCss = overlap / pixelRatio;
        const renderCssRect: Rect = {
          origin: {
            x: Math.max(0, coreCssRect.origin.x - overlapCss),
            y: Math.max(0, coreCssRect.origin.y - overlapCss),
          },
          size: {
            width:
              Math.min(input.displayWidth, end(coreCssRect, 'x') + overlapCss) -
              Math.max(0, coreCssRect.origin.x - overlapCss),
            height:
              Math.min(input.displayHeight, end(coreCssRect, 'y') + overlapCss) -
              Math.max(0, coreCssRect.origin.y - overlapCss),
          },
        };
        const outputWidth = Math.max(1, Math.round(renderCssRect.size.width * pixelRatio));
        const outputHeight = Math.max(1, Math.round(renderCssRect.size.height * pixelRatio));
        const isVisible = visibleRect ? intersects(coreCssRect, visibleRect) : false;
        const priority = contains(coreCssRect, viewportCenter.x, viewportCenter.y)
          ? 0
          : isVisible
            ? 1
            : 2;
        const coreCenter = {
          x: coreCssRect.origin.x + coreCssRect.size.width / 2,
          y: coreCssRect.origin.y + coreCssRect.size.height / 2,
        };
        const keyParts = [
          input.pageNumber,
          stableNumber(input.displayWidth),
          stableNumber(input.displayHeight),
          stableNumber(pixelRatio),
          stableNumber(coreCssRect.origin.x),
          stableNumber(coreCssRect.origin.y),
          stableNumber(coreCssRect.size.width),
          stableNumber(coreCssRect.size.height),
        ];

        tiles.push({
          key: keyParts.join(':'),
          pageNumber: input.pageNumber,
          coreCssRect,
          renderCssRect,
          pdfRect: cssRectToPdf(
            renderCssRect,
            { width: input.pdfWidth, height: input.pdfHeight },
            { width: input.displayWidth, height: input.displayHeight },
          ),
          outputWidth,
          outputHeight,
          pixelCount: outputWidth * outputHeight,
          priority,
          distanceFromViewportCenter: Math.hypot(
            coreCenter.x - viewportCenter.x,
            coreCenter.y - viewportCenter.y,
          ),
        });
      }
    }
  }

  tiles.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.distanceFromViewportCenter - right.distanceFromViewportCenter,
  );

  return {
    key: `${input.pageNumber}:${stableNumber(input.displayWidth)}:${stableNumber(input.displayHeight)}:${stableNumber(pixelRatio)}:${tiles.map((tile) => tile.key).join('|')}`,
    pageNumber: input.pageNumber,
    displayWidth: input.displayWidth,
    displayHeight: input.displayHeight,
    pixelRatio,
    tiles,
  };
}

export function limitPdfRenderTiles(tiles: PdfRenderTile[], maxPixels = pdfMaxActivePixels) {
  const sorted = [...tiles].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.distanceFromViewportCenter - right.distanceFromViewportCenter,
  );
  const retained: PdfRenderTile[] = [];
  let pixels = 0;

  for (const tile of sorted) {
    if (pixels + tile.pixelCount > maxPixels) {
      continue;
    }

    retained.push(tile);
    pixels += tile.pixelCount;
  }

  return retained;
}
