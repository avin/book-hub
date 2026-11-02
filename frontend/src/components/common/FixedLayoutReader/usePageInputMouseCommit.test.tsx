import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TextInput from '@/components/common/TextInput/TextInput';
import usePageInputMouseCommit from './usePageInputMouseCommit';

afterEach(cleanup);

function setup() {
  const commit = vi.fn();
  const view = render(() => {
    const onMouseDown = usePageInputMouseCommit(commit);
    return <TextInput type="number" value="1" onMouseDown={onMouseDown} />;
  });
  return { ...view, input: view.getByRole('spinbutton') as HTMLInputElement, commit };
}

describe('переход к странице после изменения числа мышью', () => {
  it('применяет только итоговое значение после отпускания за пределами поля', () => {
    const { input, commit } = setup();
    fireEvent.mouseDown(input, { button: 0 });
    for (const value of ['2', '3', '4']) fireEvent.input(input, { target: { value } });
    expect(commit).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, { button: 0 });
    expect(commit).toHaveBeenCalledExactlyOnceWith('4');
    fireEvent.mouseUp(window, { button: 0 });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('не применяет число при обычном клике или ручном вводе', () => {
    const { input, commit } = setup();
    fireEvent.mouseDown(input, { button: 0 });
    fireEvent.mouseUp(input, { button: 0 });
    fireEvent.input(input, { target: { value: '12' } });
    fireEvent.mouseUp(window, { button: 0 });
    expect(commit).not.toHaveBeenCalled();
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
