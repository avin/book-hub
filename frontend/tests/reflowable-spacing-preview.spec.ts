import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';
import { expectStableReaderBlocks } from './support/readerFrames';

for (const touch of [false, true]) {
  test.describe(touch ? 'касание' : 'мышь', () => {
    test.use({
      hasTouch: touch,
      isMobile: touch,
      viewport: { width: touch ? 390 : 900, height: 844 },
    });

    for (const format of ['fb2', 'epub']) {
      test(`${format}: отступ после абзаца виден до отпускания ползунка`, async ({ page }) => {
        await login(page);
        const book = books.items.find((book) => book.format === format)!;
        if (format === 'epub') {
          const files = unzipSync(books.epubFile);
          const paragraphs = Array.from(
            { length: 100 },
            (_, index) =>
              `<p>Абзац ${index + 1}. Длинная книга для проверки отступов при прокрутке.</p>`,
          ).join('');
          files['OEBPS/chapter.xhtml'] = strToU8(
            strFromU8(files['OEBPS/chapter.xhtml']).replace(
              '</section>',
              `${paragraphs}</section>`,
            ),
          );
          await page.route(`**/api/v1/books/${book.id}/file`, (route) =>
            route.fulfill({
              contentType: 'application/epub+zip',
              body: Buffer.from(zipSync(files)),
            }),
          );
        }
        await page.goto(`/reader/${book.id}`);
        await expect(page.locator('main')).toHaveCSS('visibility', 'visible');
        await page.mouse.move(0, 0);
        await page.getByRole('button', { name: 'Внешний вид', exact: true }).click();
        const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
        const slider = panel.getByRole('slider', { name: 'Отступ после абзаца', exact: true });
        await slider.scrollIntoViewIfNeeded();
        await page.evaluate(async () => {
          await document.fonts.ready;
          window.scrollTo({ top: 4000, behavior: 'instant' });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
        const anchor = await page.locator('article > div').evaluateAll((elements) => {
          const index = elements.findIndex((element) => {
            const rect = element.getBoundingClientRect();
            return element.textContent && rect.top <= 0 && rect.bottom > 0;
          });
          const slot = elements[index];
          const next = elements[index + 1];
          return {
            text: slot.textContent!,
            top: slot.getBoundingClientRect().top,
            nextText: next.textContent!,
            nextTop: next.getBoundingClientRect().top,
          };
        });
        const block = page.getByText(anchor.text, { exact: true });
        const nextBlock = page.getByText(anchor.nextText, { exact: true });
        const blockTop = () =>
          block.evaluate((element) => element.parentElement!.getBoundingClientRect().top);
        const nextBlockTop = () =>
          nextBlock.evaluate((element) => element.parentElement!.getBoundingClientRect().top);
        const articleHeight = () =>
          page.locator('article').evaluate((element) => element.getBoundingClientRect().height);
        const height = await articleHeight();
        const initial = Number(await slider.inputValue());
        await page.evaluate(() => {
          let measurements = 0;
          Object.defineProperty(window, 'readerSpacingMeasurements', { get: () => measurements });
          const measureText = OffscreenCanvasRenderingContext2D.prototype.measureText;
          OffscreenCanvasRenderingContext2D.prototype.measureText = function (text) {
            measurements += 1;
            return measureText.call(this, text);
          };
        });
        const bounds = (await slider.boundingBox())!;
        const start = { x: bounds.x + bounds.width * 0.2, y: bounds.y + bounds.height / 2 };
        const end = { ...start, x: bounds.x + bounds.width * 0.8 };
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
        let delta = Number(await slider.inputValue()) - initial;
        try {
          expect(delta).toBeGreaterThan(20);
          await expect.poll(nextBlockTop).toBeCloseTo(anchor.nextTop + delta, 0);
          expect(await blockTop()).toBeCloseTo(anchor.top, 0);
          expect(await articleHeight()).toBe(height);
          expect(await page.evaluate(() => Reflect.get(window, 'readerSpacingMeasurements'))).toBe(
            0,
          );
          const smaller = { ...start, x: bounds.x + 4 };
          if (touch) {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [smaller],
            });
          } else {
            await page.mouse.move(smaller.x, smaller.y);
          }
          await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(initial);
          delta = Number(await slider.inputValue()) - initial;
          expect(delta).toBeLessThan(0);
          await expect.poll(nextBlockTop).toBeCloseTo(anchor.nextTop + delta, 0);
          expect(await blockTop()).toBeCloseTo(anchor.top, 0);
          expect(await articleHeight()).toBe(height);
          expect(await page.evaluate(() => Reflect.get(window, 'readerSpacingMeasurements'))).toBe(
            0,
          );
        } finally {
          await expectStableReaderBlocks(
            page,
            [anchor, { text: anchor.nextText, top: anchor.nextTop + delta }],
            () =>
              touch
                ? session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
                : page.mouse.up(),
          );
          await session.detach();
        }
        await expect.poll(articleHeight).not.toBe(height);
        await expect.poll(blockTop).toBeCloseTo(anchor.top, 0);
        await expect.poll(nextBlockTop).toBeCloseTo(anchor.nextTop + delta, 0);
      });
    }
  });
}
