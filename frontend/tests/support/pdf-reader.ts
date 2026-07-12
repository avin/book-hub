import type { Page } from '@playwright/test';

export async function openPdfFiltersPanel(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  return page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Внешний вид' }) });
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
