import { expect, test } from './fixtures';
import * as books from './mocks/books';
import { login } from './support/api';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  for (const title of ['Внешний вид', 'Оглавление']) {
    test(`${title}: панель видна во время закрытия, ширина окна ${viewport.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await login(page);
      await page.goto(`/reader/${books.items[0].id}`);
      await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
      await page.mouse.move(0, 0);
      const toggle = page.getByRole('button', { name: title, exact: true });
      await toggle.click();
      const panel = page.locator('aside').filter({ hasText: title });
      await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      // Freeze the real exit transition partway through to inspect the rendered panel.
      await panel.evaluate((element) => {
        element.addEventListener('transitionrun', (event) => {
          if (
            (event as TransitionEvent).propertyName !== 'transform' ||
            !element.hasAttribute('aria-hidden')
          )
            return;
          for (const animation of element.getAnimations()) {
            animation.pause();
            animation.currentTime = 45;
          }
          element.setAttribute('data-exit-sampled', 'true');
        });
      });
      await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await expect(panel).toHaveAttribute('data-exit-sampled', 'true');
      await expect(panel).toHaveCSS('visibility', 'visible');
      await expect(panel).toHaveCSS('pointer-events', 'none');
      await expect(panel).toHaveAttribute('aria-hidden', 'true');
      const translation = await panel.evaluate(
        (element) => new DOMMatrix(getComputedStyle(element).transform).m41,
      );
      expect(translation).toBeGreaterThan(0);
      expect(translation).toBeLessThan(viewport.width);

      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.play();
      });
      await expect(panel).toHaveCSS('visibility', 'hidden');
      await page.mouse.move(0, 0);
      await toggle.click();
      await expect(panel).toHaveCSS('visibility', 'visible');
      await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      await expect(panel).toHaveCSS('pointer-events', 'auto');
    });
  }
}

test('отключённые анимации ОС убирают задержку скрытия боковых панелей', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto(`/reader/${books.items[0].id}`);
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  for (const title of ['Внешний вид', 'Оглавление']) {
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: title, exact: true }).click();
    const panel = page.locator('aside').filter({ hasText: title });
    await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(panel).toHaveCSS('transition-delay', '0s');
    await expect(panel).toHaveCSS('visibility', 'hidden');
  }
});
