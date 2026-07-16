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
  });

  it('добавляет сфокусированный вариант через стрелки и Enter', async () => {
    const { getByRole, onChange } = renderTagsSelect({ options: ['history', 'fiction'] });
    const input = getByRole('textbox');

    fireEvent.focus(input);
    await waitFor(() => expect(getByRole('button', { name: 'history' })).not.toBeNull());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['history']);
  });

  it('удаляет последний тег только после двойного Backspace', () => {
    const { getByRole, onChange } = renderTagsSelect({ initialValue: ['one', 'two'] });
    const input = getByRole('textbox');

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

      await waitFor(() => expect(getByRole('button', { name: 'Remove one' })).not.toBeNull());
    } finally {
      if (offsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
      }
    }
  });

  it('не позволяет изменять значение в disabled состоянии', () => {
    const { getByRole, onChange } = renderTagsSelect({ initialValue: ['one'], disabled: true });

    expect((getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Remove one' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
