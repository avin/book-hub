import { onCleanup, type JSX } from 'solid-js';

export default function usePageInputMouseCommit(commit: (value: string) => void) {
  let input: HTMLInputElement | undefined;
  let initialValue = '';

  const clear = () => {
    input = undefined;
    window.removeEventListener('mouseup', onMouseUp);
  };

  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const value = input?.value;
    clear();
    if (value !== undefined && value !== initialValue) commit(value);
  };

  const onMouseDown: JSX.EventHandler<HTMLInputElement, MouseEvent> = (event) => {
    if (event.button !== 0) return;
    input = event.currentTarget;
    initialValue = input.value;
    window.addEventListener('mouseup', onMouseUp);
  };

  onCleanup(clear);
  return onMouseDown;
}
