import { expect, type Page } from '@playwright/test';
import { login } from './api';

export const readerBookId = '00000000-0000-0000-0000-000000000101';

export async function openReader(page: Page) {
  await login(page);
  await page.getByRole('link', { name: 'Война и мир' }).click();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
}

export async function anchorTop(page: Page, title: string) {
  return page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );

    return heading?.getBoundingClientRect().top ?? null;
  }, title);
}

export async function anchorBounds(page: Page, title: string) {
  return page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );
    if (!heading) return null;
    const rect = heading.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  }, title);
}

export async function moveToAnchor(page: Page, title: string) {
  const chapterNumber = title === 'Глава первая' ? 1 : Number(title.match(/\d+/)?.[0] ?? 1);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(10_000);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(100);
  for (let step = 0; step < Math.max(1, chapterNumber * 2); step += 1) {
    if ((await anchorTop(page, title)) !== null) break;
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(50);
  }
  await expect.poll(() => anchorTop(page, title)).not.toBeNull();
  await page.evaluate((expectedTitle) => {
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes(expectedTitle),
    );
    heading?.scrollIntoView({ block: 'center' });
  }, title);
  await page.waitForTimeout(50);
}

export async function openReaderSettings(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Настройки внешнего вида' }).click();
  await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeVisible();
}

export async function openReaderToc(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оглавление' })).toBeVisible();
}

export async function dragRangeToEnd(page: Page, range: ReturnType<Page['locator']>) {
  await range.scrollIntoViewIfNeeded();
  const box = await range.boundingBox();
  expect(box).not.toBeNull();

  if (!box) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 8 });
  await page.mouse.up();
}
