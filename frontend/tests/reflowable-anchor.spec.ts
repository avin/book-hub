import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';

async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

test('смена семейства шрифта после размера сохраняет текущее место чтения', async ({ page }) => {
  await login(page);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
  await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const settings = page.locator('aside').filter({ hasText: 'Внешний вид' });
  await settings.getByRole('slider').first().press('ArrowRight');
  await settleLayout(page);
  await settings.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 8000, behavior: 'instant' }));
  await settleLayout(page);
  const anchor = await page.locator('article > div').evaluateAll((elements) => {
    const slot = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return element.textContent && rect.top <= 0 && rect.bottom > 0;
    })!;
    return { text: slot.textContent!, top: slot.getBoundingClientRect().top };
  });
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  await settings.locator('select').selectOption('sans-serif');
  await settleLayout(page);
  const block = page.getByText(anchor.text, { exact: true });
  await expect(block).toHaveCount(1);
  expect(
    await block.evaluate((element) => element.parentElement!.getBoundingClientRect().top),
  ).toBeCloseTo(anchor.top, 0);
});

for (const title of ['Война и мир', 'EPUB для проверки']) {
  test(`${title}: поздние шрифты и настройки сохраняют позицию перед началом текста`, async ({
    page,
  }) => {
    await login(page);
    await page.getByRole('heading', { name: title, exact: true }).getByRole('link').click();
    await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
    await settleLayout(page);

    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await settleLayout(page);
    expect(await page.evaluate(() => scrollY)).toBe(0);

    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Внешний вид' }).click();
    const fontSize = page
      .locator('aside')
      .filter({ hasText: 'Внешний вид' })
      .getByRole('slider')
      .first();
    await fontSize.press('ArrowRight');
    await settleLayout(page);
    expect(await page.evaluate(() => scrollY)).toBe(0);

    await page.evaluate(() => window.scrollTo({ top: 10, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(10);
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await settleLayout(page);
    expect(await page.evaluate(() => scrollY)).toBe(10);

    await fontSize.press('ArrowRight');
    await settleLayout(page);
    expect(await page.evaluate(() => scrollY)).toBe(10);
  });
}
