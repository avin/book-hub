import { expect, test } from './fixtures';
import { login } from './support/api';

test('читатель FB2 открывает книгу в браузере', async ({ page }) => {
  await login(page);
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();

  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
});

for (const width of [390, 1400]) {
  test(`прокрутка FB2 не сдвигает текст при смене виртуального диапазона: ${width}px`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    if (width === 1400) {
      await page.addInitScript(() =>
        localStorage.setItem(
          'book-hub-preferences',
          JSON.stringify({
            version: 1,
            language: 'ru',
            readers: {
              fb2: {
                settings: {
                  fontFamily: '"Literata", "Noto Serif", "Noto Sans", serif',
                  fontSize: 46,
                  lineHeight: 1.3,
                  paragraphSpacing: 36,
                  maxTextWidth: 1063,
                },
              },
            },
          }),
        ),
      );
    }
    await login(page);
    await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
    await expect(page.locator('main')).toHaveCSS('visibility', 'visible', { timeout: 20_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo({ top: 8000, behavior: 'instant' });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });

    const shifts = await page.evaluate(
      () =>
        new Promise<{ text: string; shift: number }[]>((resolve) => {
          const positions = new Map<Element, number>();
          const shifts: { text: string; shift: number }[] = [];
          const marker = document.createElement('div');
          marker.style.cssText = 'position:fixed;width:1px;height:1px;visibility:hidden';
          document.body.append(marker);
          let remaining = 120;
          let expectedScrollY = scrollY;
          const observer = new ResizeObserver(() => {
            if (Math.abs(scrollY - expectedScrollY) > 1)
              shifts.push({ text: 'scrollY', shift: scrollY - expectedScrollY });
            for (const slot of document.querySelectorAll('article > div')) {
              const text = slot.textContent;
              const rect = slot.getBoundingClientRect();
              if (!text || rect.bottom <= 0 || rect.top >= innerHeight) continue;
              const top = rect.top + scrollY;
              const previous = positions.get(slot);
              if (previous !== undefined && Math.abs(top - previous) > 0.001) {
                shifts.push({ text: 'block', shift: top - previous });
              }
              if (previous === undefined) positions.set(slot, top);
            }
            if (--remaining === 0) {
              observer.disconnect();
              marker.remove();
              resolve(shifts);
              return;
            }
            requestAnimationFrame(() => {
              const delta = remaining > 60 ? -60 : 60;
              expectedScrollY = scrollY + delta;
              window.scrollBy({ top: delta, behavior: 'instant' });
              marker.style.width = marker.style.width === '1px' ? '2px' : '1px';
            });
          });
          observer.observe(marker);
        }),
    );
    expect(shifts.length, JSON.stringify(shifts.slice(0, 5))).toBe(0);
  });
}
