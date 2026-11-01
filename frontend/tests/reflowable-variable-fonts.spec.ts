import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';

async function settleFonts(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
  });
}

async function textMetrics(page: Page) {
  return page
    .locator('article p')
    .first()
    .evaluate((paragraph) => {
      const style = getComputedStyle(paragraph);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const sample = document.createElement('span');
      sample.textContent = 'Типографика Typography WWW mmmmm';
      sample.style.cssText = `font: ${font}; white-space: nowrap; position: fixed`;
      sample.style.fontVariationSettings = style.fontVariationSettings;
      document.body.append(sample);
      const canvas = document.createElement('canvas').getContext('2d')!;
      canvas.font = font;
      const result = {
        family: style.fontFamily,
        weight: style.fontWeight,
        variation: style.fontVariationSettings,
        dom: sample.getBoundingClientRect().width,
        canvas: canvas.measureText(sample.textContent).width,
      };
      sample.remove();
      return result;
    });
}

for (const title of ['Война и мир', 'EPUB для проверки']) {
  test(`${title}: вариативные шрифты меняют текст, совпадают с измерениями и сохраняются`, async ({
    page,
  }) => {
    await login(page);
    await page.getByRole('heading', { name: title, exact: true }).getByRole('link').click();
    await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Внешний вид' }).click();
    const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
    const weight = panel.getByRole('slider', { name: 'Насыщенность шрифта' });
    const optical = panel.getByRole('slider', { name: 'Оптический размер', exact: true });
    await expect(weight).toHaveCount(0);
    await expect(optical).toHaveCount(0);

    await panel.locator('select').selectOption({ label: 'Literata' });
    await expect(weight).toHaveValue('400');
    await expect(weight).toHaveAttribute('min', '200');
    await expect(optical).toHaveAttribute('max', '72');
    await weight.fill('525');
    await expect(page.locator('article p').first()).toHaveCSS('font-weight', '525');
    await optical.press('Home');
    await expect.poll(async () => (await textMetrics(page)).family).toContain('opsz 7');
    await settleFonts(page);
    const small = await textMetrics(page);
    expect(Math.abs(small.dom - small.canvas)).toBeLessThan(1);
    await optical.press('End');
    await expect.poll(async () => (await textMetrics(page)).family).toContain('opsz 72');
    await settleFonts(page);
    const large = await textMetrics(page);
    expect(Math.abs(large.dom - large.canvas)).toBeLessThan(1);
    expect(Math.abs(small.dom - large.dom)).toBeGreaterThan(5);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('book-hub-preferences') ?? '{}').readers?.fb2?.settings,
        ),
      )
      .toMatchObject({ fontWeight: 525, fontOpticalSize: 72 });
    await page.reload();
    await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
    await expect.poll(async () => (await textMetrics(page)).family).toContain('opsz 72');
    await expect(page.locator('article p').first()).toHaveCSS('font-weight', '525');
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Внешний вид' }).click();
    await expect(optical).toHaveValue('72');
    await panel.getByRole('button', { name: 'Автоматический оптический размер' }).click();
    await expect.poll(async () => (await textMetrics(page)).family).not.toContain('Book Hub');
    await panel.locator('select').selectOption({ label: 'Roboto' });
    await expect(weight).toBeVisible();
    await expect(optical).toHaveCount(0);
    await panel.locator('select').selectOption({ label: 'PT Serif' });
    await expect(weight).toHaveCount(0);
    await expect(page.locator('article p').first()).toHaveCSS('font-weight', '400');
    await panel.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await panel.locator('select').selectOption({ label: 'Inter' });
    await expect(weight).toHaveValue('400');
    await expect(optical).toHaveAttribute('min', '14');
    await expect(optical).toHaveAttribute('max', '32');
    await expect(
      panel.getByRole('button', { name: 'Автоматический оптический размер' }),
    ).toBeDisabled();
  });
}

test('насыщенность и оптический размер сохраняют видимый блок после прокрутки', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Внешний вид' }).click();
  const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
  await panel.locator('select').selectOption({ label: 'Literata' });
  await settleFonts(page);
  await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
  const anchor = await page.locator('article > div').evaluateAll((elements) => {
    const slot = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return element.textContent && rect.top <= 0 && rect.bottom > 0;
    })!;
    return { text: slot.textContent!, top: slot.getBoundingClientRect().top };
  });
  for (const name of ['Насыщенность шрифта', 'Оптический размер']) {
    await panel.getByRole('slider', { name, exact: true }).press('End');
    await settleFonts(page);
    const block = page.getByText(anchor.text, { exact: true });
    await expect(block).toHaveCount(1);
    await expect
      .poll(() => block.evaluate((element) => element.parentElement!.getBoundingClientRect().top))
      .toBeCloseTo(anchor.top, 0);
  }
});

for (const touch of [false, true]) {
  test.describe(touch ? 'предпросмотр касанием' : 'предпросмотр мышью', () => {
    test.use({
      hasTouch: touch,
      isMobile: touch,
      viewport: { width: touch ? 390 : 900, height: 844 },
    });

    for (const name of ['Насыщенность шрифта', 'Оптический размер']) {
      test(`${name}: текст меняется до отпускания, высота раскладки — после`, async ({ page }) => {
        await login(page);
        await page
          .getByRole('heading', { name: 'Война и мир', exact: true })
          .getByRole('link')
          .click();
        await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
        await page.mouse.move(0, 0);
        await page.getByRole('button', { name: 'Внешний вид' }).click();
        const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
        await panel.locator('select').selectOption({ label: 'Literata' });
        await panel.getByRole('slider', { name: 'Оптический размер', exact: true }).press('Home');
        await expect.poll(async () => (await textMetrics(page)).family).toContain('opsz 7');
        await settleFonts(page);
        await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
        const slider = panel.getByRole('slider', { name, exact: true });
        await slider.scrollIntoViewIfNeeded();
        const initialValue = await slider.inputValue();
        const before = await textMetrics(page);
        const height = await page
          .locator('article')
          .evaluate((element) => element.getBoundingClientRect().height);
        const anchor = await page.locator('article > div').evaluateAll((elements) => {
          const slot = elements.find((element) => {
            const rect = element.getBoundingClientRect();
            return element.textContent && rect.top <= 0 && rect.bottom > 0;
          })!;
          return { text: slot.textContent!, top: slot.getBoundingClientRect().top };
        });
        const bounds = (await slider.boundingBox())!;
        const start = { x: bounds.x + bounds.width * 0.2, y: bounds.y + bounds.height / 2 };
        const end = { ...start, x: bounds.x + bounds.width * 0.8 };
        await page.evaluate(() => {
          let measurements = 0;
          Object.defineProperty(window, 'readerFontMeasurements', { get: () => measurements });
          const measureText = OffscreenCanvasRenderingContext2D.prototype.measureText;
          OffscreenCanvasRenderingContext2D.prototype.measureText = function (text) {
            measurements += 1;
            return measureText.call(this, text);
          };
        });
        const session = await page.context().newCDPSession(page);
        if (touch) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [start],
          });
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
        } else {
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(end.x, end.y, { steps: 4 });
        }
        try {
          await expect(slider).not.toHaveValue(initialValue);
          const value = await slider.inputValue();
          if (name === 'Насыщенность шрифта') {
            await expect.poll(async () => (await textMetrics(page)).weight).toBe(value);
          } else {
            await expect
              .poll(async () => (await textMetrics(page)).variation)
              .toBe(`"opsz" ${value}`);
          }
          const preview = await textMetrics(page);
          expect(Math.abs(preview.dom - before.dom)).toBeGreaterThan(0.5);
          expect(preview.family).toBe(before.family);
          expect(
            await page
              .locator('article')
              .evaluate((element) => element.getBoundingClientRect().height),
          ).toBe(height);
          expect(await page.evaluate(() => Reflect.get(window, 'readerFontMeasurements'))).toBe(0);
        } finally {
          if (touch)
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          else await page.mouse.up();
        }
        await expect
          .poll(() => page.evaluate(() => Reflect.get(window, 'readerFontMeasurements') as number))
          .toBeGreaterThan(0);
        const block = page.getByText(anchor.text, { exact: true });
        await expect(block).toHaveCount(1);
        await expect
          .poll(() =>
            block.evaluate((element) => element.parentElement!.getBoundingClientRect().top),
          )
          .toBeCloseTo(anchor.top, 0);
        await settleFonts(page);
        const committed = await textMetrics(page);
        expect(Math.abs(committed.dom - committed.canvas)).toBeLessThan(1);
      });
    }
  });
}
