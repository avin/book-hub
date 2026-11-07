import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TextInput from '@/components/common/TextInput/TextInput';
import usePageInput from './usePageInput';

afterEach(cleanup);

function setup() {
  const [currentPage, setCurrentPage] = createSignal(1);
  const commit = vi.fn();
  const view = render(() => {
    const pageInput = usePageInput(currentPage, commit);
    return <TextInput type="number" {...pageInput} />;
  });
  return {
    ...view,
    input: view.getByRole('spinbutton') as HTMLInputElement,
    commit,
    setCurrentPage,
  };
}

describe('переход к странице из поля номера', () => {
  it('применяет только итоговое значение после отпускания за пределами поля', () => {
    const { input, commit } = setup();
    fireEvent.mouseDown(input, { button: 0 });
    for (const value of ['2', '3', '4']) fireEvent.input(input, { target: { value } });
    expect(commit).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, { button: 0 });
    expect(commit).toHaveBeenCalledExactlyOnceWith('4');
    fireEvent.mouseUp(window, { button: 0 });
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('применяет ручной ввод при потере фокуса даже после прокрутки', () => {
    const { input, commit, setCurrentPage } = setup();
    fireEvent.mouseDown(input, { button: 0 });
    fireEvent.mouseUp(input, { button: 0 });
    fireEvent.input(input, { target: { value: '12' } });
    setCurrentPage(3);
    expect(input.value).toBe('12');
    expect(commit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledExactlyOnceWith('12');
  });

  it('применяет ручной ввод по Enter один раз и снова показывает текущую страницу', () => {
    const { input, commit, setCurrentPage } = setup();
    input.focus();
    fireEvent.input(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement).not.toBe(input);
    expect(commit).toHaveBeenCalledExactlyOnceWith('12');

    input.focus();
    setCurrentPage(5);
    expect(input.value).toBe('5');
    input.blur();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('не завершает удержание при отпускании другой кнопки', () => {
    const { input, commit } = setup();
    fireEvent.mouseDown(input, { button: 0 });
    fireEvent.input(input, { target: { value: '2' } });
    fireEvent.mouseUp(window, { button: 2 });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.mouseUp(window, { button: 0 });
    expect(commit).toHaveBeenCalledExactlyOnceWith('2');
  });

  it('снимает обработчик при закрытии читалки во время удержания', () => {
    const { input, commit, unmount } = setup();
    fireEvent.mouseDown(input, { button: 0 });
    fireEvent.input(input, { target: { value: '2' } });
    unmount();
    fireEvent.mouseUp(window, { button: 0 });
    expect(commit).not.toHaveBeenCalled();
  });
});
