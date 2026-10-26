import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './support/api';
import * as books from './mocks/books';

async function openEditor(page: Page) {
  await login(page);
  await page.getByRole('button', { name: 'Действия с книгой' }).first().click();
  await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  return page.getByRole('dialog', { name: 'Изменить книгу' });
}

test('выбор подсказки мышью сохраняет фокус, а сохранение применяет последний ввод', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.fill('фан');
  await dialog.getByRole('option', { name: 'фантастика', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Удалить тег фантастика' })).toBeVisible();
  await input.fill(' НОВЫЙ ТЕГ ');
  const saved = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/v1/books/'),
  );
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).postDataJSON().tags).toEqual([
    'классика',
    'роман',
    'фантастика',
    'новый тег',
  ]);
  await expect(dialog).toBeHidden();
});

test('стрелки повторно открывают подсказки; удалённый тег сразу доступен для выбора', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.click();
  await input.press('ArrowDown');
  const activeId = await input.getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(input).toBeFocused();
  await dialog.getByRole('button', { name: 'Удалить тег роман', exact: true }).click();
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await expect(dialog.getByRole('option', { name: 'роман', exact: true })).toBeVisible();
  await input.fill(' РОМАН ');
  await input.press('Enter');
  await input.fill('роман');
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Удалить тег роман', exact: true })).toHaveCount(
    1,
  );
  await expect(input).toHaveValue('');
});

test('Tab применяет текст и закрывает подсказки, Escape сначала закрывает список, затем редактор', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.fill('фан');
  await input.press('Tab');
  await expect(input).not.toBeFocused();
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Удалить тег фан', exact: true })).toBeVisible();
  await input.fill('нет совпадений');
  await input.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('нет совпадений');
  await input.press('Escape');
  await expect(dialog).toBeHidden();
});

test('редактирование в середине текста сохраняет курсор и регистр до добавления тега', async ({
  page,
}) => {
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await input.fill('AbCd');
  await input.press('Home');
  await input.press('ArrowRight');
  await page.keyboard.insertText('Я');
  await page.keyboard.insertText('Z');
  await expect(input).toHaveValue('AЯZbCd');
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(3);
  await input.press('Enter');
  await expect(
    dialog.getByRole('button', { name: 'Удалить тег aяzbcd', exact: true }),
  ).toBeVisible();
});

test('свёрнутые теги пересчитываются после удаления; открытый список следует ширине поля', async ({
  page,
  api,
}) => {
  const tags = [
    'очень длинный первый тег ' + 'я'.repeat(100),
    ...Array.from({ length: 15 }, (_, i) => `тег ${i}`),
  ];
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  const collapsed = dialog.getByRole('button', { name: /^\+\d+$/ });
  await collapsed.click();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await expect(input).toBeFocused();
  await collapsed.click();
  await dialog.getByRole('button', { name: `Удалить тег ${tags[0]}`, exact: true }).click();
  for (const width of [390, 768, 1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(collapsed).toBeVisible();
    const lastRemove = dialog.getByRole('button', {
      name: `Удалить тег ${tags.at(-1)}`,
      exact: true,
    });
    await expect(lastRemove).toBeVisible();
    await expect
      .poll(async () => {
        const field = await input.locator('..').boundingBox();
        const menu = await lastRemove.locator('..').locator('..').locator('..').boundingBox();
        return field && menu ? Math.abs(menu.width - field.width) : Infinity;
      })
      .toBeLessThan(2);
    await expect
      .poll(() =>
        input.evaluate((element) => {
          const field = element.parentElement!;
          const bounds = field.getBoundingClientRect();
          return [...field.querySelectorAll('[data-tag-badge], input')].every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right;
          });
        }),
      )
      .toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('tags-mobile.png') });
});

test('фильтр тегов сохраняет ввод без дубликатов и закрывает подсказки при уходе фокуса', async ({
  page,
}) => {
  await login(page);
  const input = page.getByRole('combobox', { name: 'Теги' });
  await input.fill(' РОМАН ');
  await input.press('Tab');
  await expect.poll(() => new URL(page.url()).searchParams.getAll('tag')).toEqual(['роман']);
  await input.fill('роман');
  await input.press('Enter');
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['роман']);
  await input.click();
  await expect(page.getByRole('option', { name: 'классика', exact: true })).toBeVisible();
  await input.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('достижение 50 тегов блокирует ввод, а удаление снова разрешает добавление', async ({
  page,
  api,
}) => {
  const tags = Array.from({ length: 50 }, (_, i) => `тег ${i}`);
  await api.intercept(books.req.list, {
    items: [{ ...books.items[0], tags }],
    total: 1,
    limit: 24,
    offset: 0,
  });
  const dialog = await openEditor(page);
  const input = dialog.getByRole('combobox', { name: 'Теги' });
  await expect(input).toHaveAttribute('readonly');
  await dialog.getByRole('button', { name: /^\+\d+$/ }).click();
  await dialog.getByRole('button', { name: 'Удалить тег тег 49', exact: true }).click();
  await expect(input).not.toHaveAttribute('readonly');
  await input.fill('a'.repeat(64));
  await input.press('Home');
  await input.press('ArrowRight');
  await page.keyboard.type('X');
  await expect(input).toHaveValue('a'.repeat(64));
  await input.fill('🙂'.repeat(65));
  await expect(input).toHaveValue('🙂'.repeat(64));
  await input.press('Enter');
  await expect(input).toHaveAttribute('readonly');
  const saved = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/v1/books/'),
  );
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const submitted = (await saved).postDataJSON().tags;
  expect(submitted).toHaveLength(50);
  expect(submitted.at(-1)).toBe('🙂'.repeat(64));
});

test('поля массовых и индивидуальных тегов не теряют фокус при изменении черновиков', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Загрузить книгу' }).click();
  await page.locator('input[type="file"]').setInputFiles(
    ['Первая.fb2', 'Вторая.fb2'].map((name) => ({
      name,
      mimeType: 'application/xml',
      buffer: Buffer.from('<FictionBook/>'),
    })),
  );
  const inputs = page.getByRole('combobox', { name: 'Теги' });
  const bulk = inputs.nth(0);
  const first = inputs.nth(1);
  const second = inputs.nth(2);
  await bulk.fill(' ОБЩИЙ ');
  await bulk.press('Enter');
  await expect(bulk).toBeFocused();
  await page.getByRole('button', { name: 'Применить теги для всех', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Удалить тег общий', exact: true })).toHaveCount(3);
  await first.fill('личный');
  await first.press('Enter');
  await expect(first).toBeFocused();
  await second.fill('лич');
  await page.getByRole('option', { name: 'личный', exact: true }).click();
  await expect(second).toBeFocused();
  await expect(page.getByRole('button', { name: 'Удалить тег личный', exact: true })).toHaveCount(
    2,
  );
});
