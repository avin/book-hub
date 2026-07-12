import type { Page } from '@playwright/test';

export const pdfOutlineBookId = '00000000-0000-0000-0000-000000000103';

export async function openPdfFiltersPanel(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Фильтры PDF' }).click();
  return page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Фильтры PDF' }) });
}

export async function pdfAppliedFilterKey(page: Page, pageNumber = '1') {
  return page.locator(`[data-page-number="${pageNumber}"]`).getAttribute('data-applied-filter-key');
}

export function parsePdfFilterChain(key: string | null) {
  if (!key) {
    return undefined;
  }

  return JSON.parse(key) as Array<{ id: string; enabled: boolean; [key: string]: unknown }>;
}

export async function isWebglAvailable(page: Page) {
  return page.evaluate(() => document.createElement('canvas').getContext('webgl') !== null);
}

export async function reorderPdfFilter(
  page: Page,
  sourceId: 'textEnhancement' | 'invert',
  targetId: 'textEnhancement' | 'invert',
) {
  await page.evaluate(
    async ({ source, target }) => {
      const handle = document.querySelector(`[data-testid="pdf-filter-drag-handle-${source}"]`);
      const targetElement = document.querySelector(`[data-testid="pdf-filter-item-${target}"]`);

      if (!handle || !targetElement) {
        throw new Error(`Missing drag source or target for ${source} -> ${target}`);
      }

      const handleRect = handle.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const sourceX = handleRect.left + handleRect.width / 2;
      const sourceY = handleRect.top + handleRect.height / 2;
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + 8;
      const mouseEvent = (type: string, x: number, y: number, buttons: number) =>
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        });

      handle.dispatchEvent(mouseEvent('mousedown', sourceX, sourceY, 1));
      await new Promise((resolve) => window.setTimeout(resolve));
      targetElement.dispatchEvent(mouseEvent('mousemove', targetX, targetY, 1));
      await new Promise((resolve) => window.setTimeout(resolve));
      document.dispatchEvent(mouseEvent('mouseup', targetX, targetY, 0));
    },
    { source: sourceId, target: targetId },
  );
}
