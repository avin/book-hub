import { expect, test } from './fixtures';
import { login } from './support/api';

for (const device of [
  { name: 'телефон', viewport: { width: 390, height: 844 }, hasTouch: true },
  {
    name: 'планшет в альбомной ориентации',
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
  },
  { name: 'узкое окно с мышью', viewport: { width: 390, height: 844 }, hasTouch: false },
]) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, hasTouch: device.hasTouch });

    test(`кнопка изменения полос прокрутки ${device.hasTouch ? 'скрыта' : 'видна'}`, async ({
      page,
    }) => {
      await login(page);
      await page
        .getByRole('heading', { name: 'Мастер и Маргарита', exact: true })
        .getByRole('link')
        .click();
      await expect(page.locator('[data-page-number="1"]')).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page.getByTestId('reader-floating-footer')).toHaveAttribute(
        'data-visible',
        'true',
      );
      await expect(
        page.getByRole('button', { name: 'Тонкие полосы прокрутки', includeHidden: true }),
      ).toBeVisible({ visible: !device.hasTouch });
    });
  });
}

test('тонкие полосы имеют толщину 1 px и сохраняются локально для всех читалок', async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole('heading', { name: 'Мастер и Маргарита', exact: true })
    .getByRole('link')
    .click();
  await expect(page.locator('[data-page-number="1"]')).toBeVisible();
  await page.mouse.move(0, 0);

  const toggle = page.getByRole('button', { name: 'Тонкие полосы прокрутки' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  const scrollbarSize = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement, '::-webkit-scrollbar');
      return { width: style.width, height: style.height };
    });
  await expect.poll(scrollbarSize).toEqual({ width: '1px', height: '1px' });

  await page.reload();
  await expect(page.locator('[data-page-number="1"]')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(scrollbarSize).toEqual({ width: '1px', height: '1px' });

  await page.getByRole('link', { name: 'Библиотека' }).click();
  await expect.poll(scrollbarSize).not.toEqual({ width: '1px', height: '1px' });
  await page.getByRole('heading', { name: 'Война и мир', exact: true }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Глава первая' })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(scrollbarSize).toEqual({ width: '1px', height: '1px' });
  await expect(page.locator('html')).toHaveCSS('--reader-scrollbar-background', '#f7f3ea');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(scrollbarSize).not.toEqual({ width: '1px', height: '1px' });
});
