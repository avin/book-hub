import { describe, expect, it } from 'vitest';
import { mapPdfOutline, resolvePdfDestination } from './pdfOutline';

describe('pdfOutline', () => {
  it('преобразует вложенное оглавление', () => {
    expect(
      mapPdfOutline([{ title: 'Глава', dest: 'chapter', items: [{ title: 'Раздел', dest: [1] }] }]),
    ).toEqual([{ label: 'Глава', dest: 'chapter', children: [{ label: 'Раздел', dest: [1] }] }]);
    expect(mapPdfOutline(null)).toEqual([]);
  });

  it('разрешает PDF-назначения и ограничивает смещение страницей', async () => {
    const document = {
      getDestination: async () => [{ num: 7, gen: 0 }, 'XYZ', null, 100],
      getPageIndex: async () => 2,
      getPage: async () => ({ getViewport: () => ({ width: 200, height: 1000 }) }),
    };

    await expect(resolvePdfDestination(document as never, 'chapter', 400)).resolves.toEqual({
      pageNumber: 3,
      offsetRatio: 0.9,
    });
    await expect(resolvePdfDestination(document as never, null, 400)).resolves.toBeUndefined();
  });
});
