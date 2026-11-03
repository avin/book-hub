import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';
import { expectStableReaderBlocks } from './support/readerFrames';

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

for (const touch of [false, true]) {
  test.describe(touch ? 'сенсорное управление' : 'мышь', () => {
    test.use({
      hasTouch: touch,
      isMobile: touch,
      viewport: { width: touch ? 390 : 640, height: 800 },
    });
    for (const [settingIndex, settingName] of [
      'размер',
      'интерлиньяж',
      'отступ строки',
      'отступ абзаца',
      'боковые отступы',
    ].entries()) {
      test(`после оглавления и прокрутки изменение оформления сохраняет видимый блок: ${settingName}`, async ({
        page,
      }) => {
        const session = await page.context().newCDPSession(page);
        if (touch) await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        await login(page);
        await page
          .getByRole('heading', { name: 'Война и мир', exact: true })
          .getByRole('link')
          .click();
        await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
        await page.mouse.move(0, 0);
        await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
        const toc = page.locator('aside').filter({ hasText: 'Оглавление' });
        await toc.getByRole('button', { name: 'Глава 20', exact: true }).click();
        await toc.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Глава 20', exact: true })).toBeInViewport();
        await settleLayout(page);
        const chapterScrollY = await page.evaluate(() => scrollY);
        await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'instant' }));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(chapterScrollY + 350);
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
        const slider = page
          .locator('aside')
          .filter({ hasText: 'Внешний вид' })
          .getByRole('slider')
          .nth(settingIndex);
        await slider.scrollIntoViewIfNeeded();
        const initialValue = await slider.inputValue();
        const bounds = (await slider.boundingBox())!;
        const point = { x: bounds.x + bounds.width * 0.6, y: bounds.y + bounds.height / 2 };
        if (touch) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [point],
          });
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...point, x: point.x + 20 }],
          });
        } else {
          await page.mouse.move(point.x, point.y);
          await page.mouse.down();
        }
        await expectStableReaderBlocks(page, [anchor], () =>
          touch
            ? session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            : page.mouse.up(),
        );
        await expect(slider).not.toHaveValue(initialValue);
        // Width changes also schedule a debounced layout after the gesture ends.
        await page.waitForTimeout(250);
        await settleLayout(page);
        const block = page.getByText(anchor.text, { exact: true });
        await expect(block).toHaveCount(1);
        expect(
          await block.evaluate((element) => element.parentElement!.getBoundingClientRect().top),
        ).toBeCloseTo(anchor.top, 0);
      });
    }
  });
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
