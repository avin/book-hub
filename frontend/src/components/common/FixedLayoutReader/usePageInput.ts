import { batch, createSignal, onCleanup, type Accessor, type JSX } from 'solid-js';

export default function usePageInput(
  currentPage: Accessor<number>,
  commit: (value: string) => void,
) {
  const [draft, setDraft] = createSignal<string>();
  let input: HTMLInputElement | undefined;
  let initialValue = '';

  const commitDraft = () => {
    const value = draft();
    if (value === undefined) return;
    batch(() => {
      setDraft(undefined);
      commit(value);
    });
  };

  const clear = () => {
    input = undefined;
    window.removeEventListener('mouseup', onMouseUp);
  };

  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const value = input?.value;
    clear();
    if (value !== undefined && value !== initialValue) commitDraft();
  };

  const onMouseDown: JSX.EventHandler<HTMLInputElement, MouseEvent> = (event) => {
    if (event.button !== 0) return;
    input = event.currentTarget;
    initialValue = input.value;
    window.addEventListener('mouseup', onMouseUp);
  };

  const onInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    setDraft(event.currentTarget.value);
  };

  const onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitDraft();
    event.currentTarget.blur();
  };

  onCleanup(clear);
  return {
    get value() {
      return draft() ?? String(currentPage());
    },
    onMouseDown,
    onInput,
    onBlur: commitDraft,
    onKeyDown,
  };
}
