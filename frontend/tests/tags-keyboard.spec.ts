import { type Page, type Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';

const tags = Array.from({ length: 8 }, (_, index) => `длинный тег ${index + 1}`);

async function openEditor(page: Page) {
  await login(page);
  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  return page.getByRole('dialog', { name: 'Изменить книгу' });
}

async function openGroup(page: Page, dialog: Locator, key = 'Enter') {
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.focus();
  await page.keyboard.press('Shift+Tab');
  const collapsed = dialog.getByRole('button', { name: /^\+\d+$/ });
  await expect(collapsed).toBeFocused();
  await page.keyboard.press(key);
  const group = dialog.getByRole('group', { name: 'Выбранные теги' });
  await expect(group).toBeVisible();
  return { input, collapsed, group };
}

test.beforeEach(async ({ page, api }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags }],
    total: 1,
    limit: 24,
    offset: 0,
  });
});

test('Tab обходит раскрытую группу перед инпутом, Shift+Tab проходит обратно без ловушки', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const { input, collapsed, group } = await openGroup(page, dialog);
  const removals = group.getByRole('button');
  const count = await removals.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    await expect(removals.nth(i)).toBeFocused();
    await expect(group).toBeVisible();
    if (i === 0) {
      expect(
        await removals.nth(i).evaluate((element) => getComputedStyle(element).outlineStyle),
      ).not.toBe('none');
      await dialog.screenshot({ path: test.info().outputPath('keyboard-focused-tag.png') });
    }
  }
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await expect(group).toBeVisible();
  for (let i = count - 1; i >= 0; i--) {
    await page.keyboard.press('Shift+Tab');
    await expect(removals.nth(i)).toBeFocused();
  }
  await page.keyboard.press('Shift+Tab');
  await expect(collapsed).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const visibleRemovals = input.locator('..').getByRole('button', { name: /^Удалить тег / });
  for (let i = (await visibleRemovals.count()) - 1; i >= 0; i--) {
    await expect(visibleRemovals.nth(i)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
  }
  await expect(dialog.getByRole('textbox', { name: 'Описание' })).toBeFocused();
  await expect(group).toBeHidden();

  await openGroup(page, dialog, 'Space');
  for (let i = 0; i <= count; i++) await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await expect(group).toBeHidden();
});

for (const position of ['first', 'middle', 'last'] as const) {
  for (const key of ['Enter', 'Space']) {
    test(`удаление ${position} через ${key} сохраняет фокус на соседнем теге`, async ({ page }) => {
      const dialog = await openEditor(page);
      const { group } = await openGroup(page, dialog);
      const count = await group.getByRole('button').count();
      const index =
        position === 'first' ? 0 : position === 'last' ? count - 1 : Math.floor(count / 2);
      const labels = await group
        .getByRole('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')!));
      for (let i = 0; i <= index; i++) await page.keyboard.press('Tab');
      await expect(group.getByRole('button').nth(index)).toBeFocused();
      await page.keyboard.press(key);
      await expect(dialog.getByRole('button', { name: labels[index], exact: true })).toHaveCount(0);
      const expected = labels[index + 1] ?? labels[index - 1];
      await expect(dialog.getByRole('button', { name: expected, exact: true })).toBeFocused();
      await expect(group).toBeVisible();
    });
  }
}

test('удаление единственного скрытого тега возвращает фокус в инпут', async ({ page, api }) => {
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags: ['я'.repeat(64)] }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  const dialog = await openEditor(page);
  const { input, group, collapsed } = await openGroup(page, dialog);
  await page.keyboard.press('Tab');
  await expect(group.getByRole('button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(group).toHaveCount(0);
  await expect(collapsed).toHaveCount(0);
  await page.keyboard.type('новый');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Удалить тег новый' })).toBeVisible();
});

test('переходы и удаление в группе сохраняют незавершённый ввод', async ({ page }) => {
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.fill('черновик');
  const { group } = await openGroup(page, dialog);
  await page.keyboard.press('Tab');
  await expect(group.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('черновик');
  await expect(dialog.getByRole('button', { name: 'Удалить тег черновик' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('черновик');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
});

test('сфокусированный тег сохраняет фокус при переходе из группы в строку и обратно', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const { group } = await openGroup(page, dialog);
  await page.keyboard.press('Tab');
  const label = await group.getByRole('button').first().getAttribute('aria-label');
  await expect(group.getByRole('button').first()).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  const sameTag = dialog.getByRole('button', { name: label!, exact: true });
  await expect(sameTag).toBeFocused();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(group).toBeVisible();
  await expect(sameTag).toBeFocused();
});

test('Escape со скрытого тега закрывает только группу и возвращает фокус', async ({ page }) => {
  const dialog = await openEditor(page);
  const { input, group } = await openGroup(page, dialog);
  await page.keyboard.press('Tab');
  await expect(group.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('последовательное удаление всех тегов не теряет фокус при исчезновении группы', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const { input } = await openGroup(page, dialog);
  await page.keyboard.press('Tab');
  for (let remaining = tags.length; remaining > 0; remaining--) {
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-tag-remove')))
      .toBe(true);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('button', { name: /^Удалить тег / })).toHaveCount(remaining - 1);
  }
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('button', { name: /^\+\d+$/ })).toHaveCount(0);
});

test('удержание Enter удаляет один тег, отпускание и новое нажатие — следующий', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const { group } = await openGroup(page, dialog);
  const count = await group.getByRole('button').count();
  await page.keyboard.press('Tab');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(group.getByRole('button')).toHaveCount(count - 1);
  await page.keyboard.press('Enter');
  await expect(group.getByRole('button')).toHaveCount(count - 2);
});

test('исчезновение сфокусированной кнопки +N при расширении возвращает фокус в инпут', async ({
  page,
  api,
}) => {
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags: ['длинный первый тег', 'длинный второй тег'] }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  const dialog = await openEditor(page);
  const { input, collapsed } = await openGroup(page, dialog);
  await expect(collapsed).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(collapsed).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Выбранные теги' })).toHaveCount(0);
});

test('клик снаружи применяет незавершённый ввод ровно один раз после обхода группы', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.fill('черновик');
  await openGroup(page, dialog);
  await page.keyboard.press('Tab');
  await dialog.getByRole('heading', { name: 'Изменить книгу' }).click();
  await expect(input).toHaveValue('');
  await expect(dialog.getByRole('group', { name: 'Выбранные теги' })).toHaveCount(0);
  await dialog.getByRole('button', { name: /^\+\d+$/ }).click();
  await expect(
    dialog.getByRole('button', { name: 'Удалить тег черновик', exact: true }),
  ).toHaveCount(1);
});

test('группа в фильтре библиотеки проходится клавиатурой и обновляет URL после удаления', async ({
  page,
}) => {
  await login(page);
  const params = new URLSearchParams();
  tags.forEach((tag) => params.append('tag', tag));
  await page.goto(`/library?${params}`);
  const input = page.getByRole('combobox', { name: 'Теги' });
  await input.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  const group = page.getByRole('group', { name: 'Выбранные теги' });
  const names = await group
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')!.replace('Удалить тег ', '')),
    );
  await page.keyboard.press('Tab');
  await expect(group.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('tag'))
    .toEqual(tags.filter((tag) => tag !== names[0]));
  await expect(group.getByRole('button').first()).toBeFocused();
});

test('раскрытые теги одного черновика не мешают перейти к следующему полю загрузки', async ({
  page,
}) => {
  await login(page);
  await page.goto('/upload');
  await page.locator('input[type="file"]').setInputFiles(
    ['Первая.fb2', 'Вторая.fb2'].map((name) => ({
      name,
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    })),
  );
  const input = page.getByRole('combobox', { name: 'Теги' }).nth(1);
  for (const tag of tags) {
    await input.fill(tag);
    await input.press('Enter');
  }
  await input.press('Shift+Tab');
  await page.keyboard.press('Enter');
  const group = page.getByRole('group', { name: 'Выбранные теги' });
  const count = await group.getByRole('button').count();
  await page.keyboard.press('Tab');
  await expect(group.getByRole('button').first()).toBeFocused();
  for (let i = 1; i <= count; i++) await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).not.toBeFocused();
  await expect(group).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Теги' }).nth(2)).toHaveValue('');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test.skip(
    ({ browserName }) => browserName === 'firefox',
    'Firefox не эмулирует touch через Playwright',
  );
  test('сенсорный выбор и удаление сохраняют текст и позволяют продолжить ввод', async ({
    page,
  }) => {
    const dialog = await openEditor(page);
    const input = dialog.getByRole('combobox', { name: 'Теги' });
    await input.fill('черновик');
    await dialog.getByRole('button', { name: /^\+\d+$/ }).tap();
    const group = dialog.getByRole('group', { name: 'Выбранные теги' });
    await group.getByRole('button').last().tap();
    await expect(group).toBeVisible();
    await expect(input).toHaveValue('черновик');
    await input.fill('фан');
    await dialog.getByRole('option', { name: 'фантастика', exact: true }).tap();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await page.keyboard.type('дальше');
    await expect(input).toHaveValue('дальше');
  });
});
