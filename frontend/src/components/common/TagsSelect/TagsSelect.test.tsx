import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import TagsSelect from './TagsSelect';

class ResizeObserverMock {
  disconnect() {}

  observe() {}
}

function ControlledTagsSelect(props: {
  initialValue?: string[];
  options?: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [value, setValue] = createSignal(props.initialValue ?? []);

  return (
    <I18nProvider>
      <TagsSelect
        value={value()}
        options={props.options}
        disabled={props.disabled}
        onChange={(nextValue) => {
          props.onChange(nextValue);
          setValue(nextValue);
        }}
      />
    </I18nProvider>
  );
}

function renderTagsSelect(props: Omit<Parameters<typeof ControlledTagsSelect>[0], 'onChange'>) {
  const onChange = vi.fn();
  const view = render(() => <ControlledTagsSelect {...props} onChange={onChange} />);

  return { ...view, onChange };
}

describe('TagsSelect', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('добавляет сфокусированный вариант через стрелки и Enter', async () => {
    const { getByRole, onChange } = renderTagsSelect({ options: ['history', 'fiction'] });
    const input = getByRole('combobox');

    fireEvent.focus(input);
    await waitFor(() => expect(getByRole('option', { name: 'history' })).not.toBeNull());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['history']);
  });

  it('удаляет последний тег только после двойного Backspace', () => {
    const { getByRole, onChange } = renderTagsSelect({ initialValue: ['one', 'two'] });
    const input = getByRole('combobox');

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['one']);
  });

  it('показывает свёрнутые теги через отдельный интерактивный badge', async () => {
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 50,
    });

    try {
      const { getByRole } = renderTagsSelect({ initialValue: ['one', 'two'] });
      const collapsedBadge = await waitFor(() => getByRole('button', { name: '+2' }));

      fireEvent.keyDown(collapsedBadge, { key: 'Enter' });

      await waitFor(() => expect(getByRole('button', { name: 'Remove tag one' })).not.toBeNull());
    } finally {
      if (offsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
      }
    }
  });

  it('не позволяет изменять значение в disabled состоянии', () => {
    const { getByRole, onChange } = renderTagsSelect({ initialValue: ['one'], disabled: true });

    expect((getByRole('combobox') as HTMLInputElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Remove tag one' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('нормализует дубликат и пробельный ввод, не вызывая onChange', () => {
    const { getByRole, onChange } = renderTagsSelect({ initialValue: ['one'] });
    const input = getByRole('combobox') as HTMLInputElement;
    for (const text of [' ONE ', '   ']) {
      fireEvent.input(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input.value).toBe('');
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ограничивает ввод 64 Unicode-символами', () => {
    const { getByRole, onChange } = renderTagsSelect({});
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '🙂'.repeat(65) } });
    expect(input.value).toBe('🙂'.repeat(64));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['🙂'.repeat(64)]);
  });

  it('оставляет клавиатурные сокращения редактирования браузеру', () => {
    const { getByRole, onChange } = renderTagsSelect({ initialValue: ['one'] });
    const input = getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 'Backspace', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Enter', altKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('вставляет только помещающуюся часть текста, сохраняя суффикс и курсор', () => {
    const { getByRole } = renderTagsSelect({});
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'a'.repeat(62) + 'Z' } });
    input.setSelectionRange(62, 62);
    fireEvent.paste(input, { clipboardData: { getData: () => '🙂🙂' } });
    expect(input.value).toBe('a'.repeat(62) + '🙂Z');
    expect(input.selectionStart).toBe(64);
  });

  it('не применяет ввод по Enter во время IME composition', () => {
    const { getByRole, onChange } = renderTagsSelect({});
    const input = getByRole('combobox');
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: '日本' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['日本']);
  });

  it('Escape во время IME не закрывает подсказки', async () => {
    const { getByRole } = renderTagsSelect({ options: ['history'] });
    const input = getByRole('combobox');
    fireEvent.focus(input);
    await waitFor(() => expect(getByRole('listbox')).not.toBeNull());
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(getByRole('listbox')).not.toBeNull();
  });

  it('закрывает подсказки при Tab с пустым вводом и сбрасывает удаление при blur', async () => {
    const { getByRole, queryByRole, onChange } = renderTagsSelect({
      initialValue: ['one'],
      options: ['history'],
    });
    const input = getByRole('combobox');
    fireEvent.focus(input);
    await waitFor(() => expect(getByRole('option', { name: 'history' })).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.focusOut(input);
    await waitFor(() => expect(queryByRole('option', { name: 'history' })).toBeNull());
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('внешнее удаление сфокусированного тега переводит фокус на соседа и затем в инпут', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50);
    let updateTags!: (value: string[]) => void;
    const { getByRole } = render(() => {
      const [value, setValue] = createSignal(['one', 'two', 'three']);
      updateTags = setValue;
      return (
        <I18nProvider>
          <TagsSelect value={value()} onChange={setValue} />
        </I18nProvider>
      );
    });
    fireEvent.click(await waitFor(() => getByRole('button', { name: '+3' })));
    getByRole('button', { name: 'Remove tag two' }).focus();
    updateTags(['one', 'three']);
    await waitFor(() =>
      expect(document.activeElement).toBe(getByRole('button', { name: 'Remove tag three' })),
    );
    updateTags([]);
    await waitFor(() => expect(document.activeElement).toBe(getByRole('combobox')));
  });

  it('перестановка тегов извне сохраняет фокус на том же теге', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50);
    let updateTags!: (value: string[]) => void;
    const { getByRole } = render(() => {
      const [value, setValue] = createSignal(['one', 'two', 'three']);
      updateTags = setValue;
      return (
        <I18nProvider>
          <TagsSelect value={value()} onChange={setValue} />
        </I18nProvider>
      );
    });
    fireEvent.click(await waitFor(() => getByRole('button', { name: '+3' })));
    getByRole('button', { name: 'Remove tag three' }).focus();
    updateTags(['three', 'one', 'two']);
    await waitFor(() =>
      expect(document.activeElement).toBe(getByRole('button', { name: 'Remove tag three' })),
    );
  });

  it('завершение IME на предельной длине не удаляет суффикс строки', () => {
    const { getByRole } = renderTagsSelect({});
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'a'.repeat(63) + 'Z' } });
    input.setSelectionRange(63, 63);
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: 'a'.repeat(63) + '日本Z' } });
    fireEvent.compositionEnd(input);
    expect(input.value).toBe('a'.repeat(63) + 'Z');
  });

  it('IME вставляет помещающуюся часть в выделение, сохраняя суффикс и Unicode', () => {
    const { getByRole } = renderTagsSelect({});
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'a'.repeat(62) + 'XZ' } });
    input.setSelectionRange(62, 63);
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: 'a'.repeat(62) + '🙂🙂Z' } });
    fireEvent.compositionEnd(input);
    expect(input.value).toBe('a'.repeat(62) + '🙂Z');
    expect(input.selectionStart).toBe(64);
  });
});
