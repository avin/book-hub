import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTagOptionSearch, createTagSelectionModel } from './tagSelectionModel';

const disposers: (() => void)[] = [];

function setup(search?: (query: string) => string[] | Promise<string[]>) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [value, setValue] = createSignal<string[]>([]);
    const [options, setOptions] = createSignal(['history', 'fiction']);
    const [disabled, setDisabled] = createSignal(false);
    const onChange = vi.fn((next: string[]) => setValue(next));
    const model = createTagSelectionModel({
      value,
      options,
      disabled,
      onSearchOptions: () => search,
      onChange,
      showOptionsOnFocus: () => true,
    });
    return { model, value, setValue, setOptions, setDisabled, onChange };
  });
}

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
  vi.useRealTimers();
});

describe('tag option search', () => {
  it('игнорирует результат устаревшего асинхронного запроса', async () => {
    const search = createTagOptionSearch();
    let resolveFirst: (value: string[]) => void;
    const first = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });

    const firstResult = search.run(() => first);
    const secondResult = search.run(() => ['newer']);

    expect(await secondResult).toEqual(['newer']);
    resolveFirst!(['stale']);
    await expect(firstResult).resolves.toBeUndefined();
  });
});

describe('tag selection interactions', () => {
  it('не добавляет 51-й тег, но позволяет удалить тег и добавить другой', () => {
    const { model, setValue, value } = setup();
    setValue(Array.from({ length: 50 }, (_, i) => `tag-${i}`));
    model.addTag('extra');
    expect(value()).toHaveLength(50);
    model.removeTag('tag-0');
    model.addTag('extra');
    expect(value()).toHaveLength(50);
    expect(value()).toContain('extra');
  });
  it('обновляет открытые подсказки при изменении доступных и выбранных тегов', async () => {
    const { model, setOptions, setValue } = setup();
    model.openOptions();
    await Promise.resolve();
    await Promise.resolve();
    setOptions(['history', 'science']);
    setValue(['history']);
    await Promise.resolve();
    await Promise.resolve();
    expect(model.options()).toEqual(['science']);
  });

  it('сразу убирает старые подсказки и игнорирует ответ во время debounce нового запроса', async () => {
    vi.useFakeTimers();
    let resolveOld!: (tags: string[]) => void;
    const { model } = setup((query) =>
      query === '' ? new Promise((resolve) => (resolveOld = resolve)) : ['fiction'],
    );
    model.openOptions();
    model.handleChangeQuery('fi');
    resolveOld(['history']);
    await Promise.resolve();
    await Promise.resolve();
    expect(model.options()).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(model.options()).toEqual(['fiction']);
    model.handleChangeQuery('xyz');
    expect(model.options()).toEqual([]);
  });

  it('возвращает удалённый тег в подсказки без повторного фокуса', async () => {
    const { model, setValue } = setup();
    setValue(['history']);
    model.openOptions();
    await Promise.resolve();
    await Promise.resolve();
    model.removeTag('history');
    expect(model.options()).toContain('history');
  });

  it('Enter выбирает подсвеченный вариант; новый ввод сбрасывает подсветку', async () => {
    const { model, value } = setup();
    model.openOptions();
    await Promise.resolve();
    await Promise.resolve();
    model.focusOption(0);
    model.applyCurrentInput();
    expect(value()).toEqual(['history']);
    model.openOptions();
    model.focusOption(0);
    model.handleChangeQuery('new tag');
    model.applyCurrentInput();
    expect(value()).toEqual(['history', 'new tag']);
  });

  it('не изменяет теги и закрывает подсказки при динамическом disabled', async () => {
    const { model, setDisabled, onChange } = setup();
    model.openOptions();
    await Promise.resolve();
    await Promise.resolve();
    setDisabled(true);
    expect(model.isDropdownOpen()).toBe(false);
    model.addTag('new');
    model.removeTag('history');
    model.handleChangeQuery('other');
    model.applyTypedInput();
    model.toggleCollapsedDropdown();
    expect(onChange).not.toHaveBeenCalled();
    expect(model.isDropdownOpen()).toBe(false);
  });

  it('сбрасывает двойной Backspace при другом действии и не удаляет по удержанию', () => {
    const { model, setValue, value } = setup();
    setValue(['one', 'two']);
    model.handleEmptyInputBackspace('', 0, false, 1000);
    model.moveFocusedOption(1);
    model.handleEmptyInputBackspace('', 0, false, 1100);
    expect(value()).toEqual(['one', 'two']);
    model.handleEmptyInputBackspace('', 0, true, 1200);
    expect(value()).toEqual(['one', 'two']);
    model.closeDropdown();
    model.handleEmptyInputBackspace('', 0, false, 2000);
    model.openOptions();
    model.handleEmptyInputBackspace('', 0, false, 2100);
    expect(value()).toEqual(['one', 'two']);
  });

  it('первый Backspace после запуска таймера никогда не удаляет тег', () => {
    const { model, setValue, value } = setup();
    setValue(['one']);
    model.handleEmptyInputBackspace('', 0, false, 100);
    expect(value()).toEqual(['one']);
  });

  it('пара Backspace раскрывает скрытые теги, следующая пара удаляет последний', () => {
    const { model, setValue, value } = setup();
    setValue(['one', 'two']);
    model.handleEmptyInputBackspace('', 2, false, 1000);
    model.handleEmptyInputBackspace('', 2, false, 1100);
    expect(model.isCollapsedOpen()).toBe(true);
    expect(value()).toEqual(['one', 'two']);
    model.handleEmptyInputBackspace('', 2, true, 1200);
    expect(value()).toEqual(['one', 'two']);
    model.handleEmptyInputBackspace('', 2, false, 1300);
    model.handleEmptyInputBackspace('', 2, false, 1400);
    expect(value()).toEqual(['one']);
  });

  it.each(['close', 'collapsed', 'disabled', 'dispose'] as const)(
    'игнорирует поздний ответ после %s',
    async (action) => {
      let resolveSearch!: (tags: string[]) => void;
      const { model, setDisabled } = setup(
        () => new Promise((resolve) => (resolveSearch = resolve)),
      );
      model.openOptions();
      if (action === 'close') model.closeDropdown();
      if (action === 'collapsed') model.toggleCollapsedDropdown();
      if (action === 'disabled') setDisabled(true);
      if (action === 'dispose') disposers.pop()!();
      resolveSearch(['late']);
      await Promise.resolve();
      await Promise.resolve();
      expect(model.options()).not.toContain('late');
      expect(model.isOptionsOpen()).toBe(false);
    },
  );

  it('позволяет добавить свой тег после ошибки поиска', async () => {
    vi.useFakeTimers();
    const { model, value } = setup(() => Promise.reject(new Error('offline')));
    model.handleChangeQuery(' Новый ');
    await vi.advanceTimersByTimeAsync(200);
    expect(model.options()).toEqual([]);
    model.applyCurrentInput();
    expect(value()).toEqual(['новый']);
  });
});
