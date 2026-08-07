import { describe, expect, it } from 'vitest';
import { PdfActionType, PdfZoomMode } from '@embedpdf/models';
import { mapPdfOutline, resolvePdfDestination } from './pdfOutline';

describe('pdfOutline', () => {
  it('преобразует вложенное оглавление', () => {
    expect(
      mapPdfOutline([
        {
          title: 'Глава',
          target: {
            type: 'action',
            action: {
              type: PdfActionType.Goto,
              destination: { pageIndex: 2, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
            },
          },
          children: [{ title: 'Раздел' }],
        },
      ]),
    ).toEqual([
      {
        label: 'Глава',
        destination: { pageIndex: 2, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
        children: [{ label: 'Раздел', destination: undefined, children: undefined }],
      },
    ]);
    expect(mapPdfOutline(null)).toEqual([]);
  });

  it('разрешает PDF-назначения и ограничивает смещение страницей', () => {
    expect(
      resolvePdfDestination(
        {
          pageIndex: 2,
          zoom: { mode: PdfZoomMode.XYZ, params: { x: 0, y: 100, zoom: 1 } },
          view: [],
        },
        1000,
      ),
    ).toEqual({
      pageNumber: 3,
      offsetRatio: 0.9,
    });
    expect(resolvePdfDestination(undefined, undefined)).toBeUndefined();
  });
});
