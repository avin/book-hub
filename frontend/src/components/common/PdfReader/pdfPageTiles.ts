export type PdfTileBounds = {
  deviceTop: number;
  deviceHeight: number;
};

export type PdfTileRange = {
  first: number;
  last: number;
};

const tileCssHeight = 1024;
const maxSingleTileCssHeight = tileCssHeight * 2;

// Длинные страницы (журналы, веб-страницы) растеризуются полосами:
// перерисовка целой страницы высотой в десятки тысяч пикселей занимает секунды.
export function pdfPageTileCount(displayHeight: number) {
  if (displayHeight <= maxSingleTileCssHeight) {
    return 1;
  }

  return Math.ceil(displayHeight / tileCssHeight);
}

// Полосы перекрываются на `overlap` строк снизу, чтобы на дробных
// координатах между соседними canvas не просвечивала граница.
export function pdfTileBounds(
  index: number,
  tileCount: number,
  pageDeviceHeight: number,
  overlap: number,
): PdfTileBounds {
  const deviceTop = Math.floor((index * pageDeviceHeight) / tileCount);
  const nextTop =
    index + 1 >= tileCount
      ? pageDeviceHeight
      : Math.min(
          pageDeviceHeight,
          Math.floor(((index + 1) * pageDeviceHeight) / tileCount) + overlap,
        );

  return { deviceTop, deviceHeight: Math.max(1, nextTop - deviceTop) };
}

export function pdfTileRangeInZone(
  pageTop: number,
  pageHeight: number,
  tileCount: number,
  zoneTop: number,
  zoneBottom: number,
): PdfTileRange | undefined {
  const pageBottom = pageTop + pageHeight;

  if (pageHeight <= 0 || pageBottom < zoneTop || pageTop > zoneBottom) {
    return undefined;
  }

  const tileHeight = pageHeight / tileCount;
  const first = Math.floor((Math.max(zoneTop, pageTop) - pageTop) / tileHeight);
  const last = Math.floor((Math.min(zoneBottom, pageBottom) - pageTop) / tileHeight);

  return {
    first: Math.min(tileCount - 1, Math.max(0, first)),
    last: Math.min(tileCount - 1, Math.max(0, last)),
  };
}

export function pdfTileDistanceToZone(
  pageTop: number,
  pageHeight: number,
  tileCount: number,
  index: number,
  zoneTop: number,
  zoneBottom: number,
) {
  const tileHeight = pageHeight / tileCount;
  const tileTop = pageTop + index * tileHeight;
  const tileBottom = tileTop + tileHeight;

  if (tileBottom < zoneTop) {
    return zoneTop - tileBottom;
  }

  if (tileTop > zoneBottom) {
    return tileTop - zoneBottom;
  }

  return 0;
}
