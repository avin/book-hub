import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const format of ['fb2', 'pdf']) {
    test(`${format}: прозрачность при регулировке ползунка, reducedMotion=${reducedMotion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await login(page);
      const book = books.items.find((book) => book.format === format)!;
      await page.goto(`/reader/${book.id}`);
      if (format === 'pdf') {
        await expect(page.locator('[data-page-number="1"] canvas').first()).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
      }
      await page.mouse.move(0, 0);
      await page.getByRole('button', { name: 'Внешний вид', exact: true }).click();
      const panel = page.locator('aside').filter({ hasText: 'Внешний вид' });
      await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      await expect(panel).toHaveCSS('opacity', '1');
      const opacityTransition = await panel.evaluate((element) => {
        const style = getComputedStyle(element);
        const index = style.transitionProperty
          .split(',')
          .map((value) => value.trim())
          .indexOf('opacity');
        return {
          duration: style.transitionDuration.split(',')[index]?.trim(),
          timingFunction: style.transitionTimingFunction.split(/,(?![^()]*\))/)[index]?.trim(),
        };
      });
      expect(opacityTransition).toEqual({ duration: '0.12s', timingFunction: 'linear' });

      const slider = panel.getByRole('slider').first();
      const bounds = (await slider.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await expect(panel).toHaveCSS('opacity', '0.5');
      const initial = await slider.inputValue();
      await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
      await expect(slider).not.toHaveValue(initial);
      await expect(panel).toHaveCSS('opacity', '0.5');
      // Pointer capture must restore the panel even when released outside it.
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await expect(panel).toHaveCSS('opacity', '1');

      await slider.press('ArrowRight');
      await expect(panel).toHaveCSS('opacity', '1');
    });
  }
}
