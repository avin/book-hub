import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import AutosizeTextarea from './AutosizeTextarea';

describe('AutosizeTextarea', () => {
  afterEach(cleanup);
  it('не вставляет половину эмодзи и приводит переносы к формату поля ввода', () => {
    render(() => {
      const [value, setValue] = createSignal('abcd');
      return (
        <AutosizeTextarea aria-label="Описание" value={value()} onInput={setValue} maxLength={5} />
      );
    });
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    field.setSelectionRange(4, 4);
    fireEvent.paste(field, { clipboardData: { getData: () => '🙂текст' } });
    expect(field.value).toBe('abcd');
    field.setSelectionRange(0, 4);
    fireEvent.paste(field, { clipboardData: { getData: () => 'а\r\nб\rв' } });
    expect(field.value).toBe('а\nб\nв');
  });

  it('вставляет помещающуюся часть текста с учётом выделения, не разделяя эмодзи', () => {
    render(() => {
      const [value, setValue] = createSignal('abcd');
      return (
        <AutosizeTextarea aria-label="Описание" value={value()} onInput={setValue} maxLength={6} />
      );
    });
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    field.setSelectionRange(1, 3);
    fireEvent.paste(field, { clipboardData: { getData: () => '🙂🙂🙂' } });
    expect(field.value).toBe('a🙂🙂d');
    expect(field.selectionStart).toBe(5);
    field.setSelectionRange(5, 5);
    fireEvent.paste(field, { clipboardData: { getData: () => 'текст' } });
    expect(field.value).toBe('a🙂🙂d');
  });
});
