import { createEffect, on, onCleanup, onMount } from 'solid-js';
import inputStyles from '@/components/common/TextInput/TextInput.module.scss';
import styles from './AutosizeTextarea.module.scss';

function AutosizeTextarea(props: {
  value: string;
  onInput: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  let textarea!: HTMLTextAreaElement;

  const resize = () => {
    const style = getComputedStyle(textarea);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const minimum = parseFloat(style.minHeight);
    const maximum = parseFloat(style.lineHeight) * 10 + padding + borders;
    textarea.style.overflowY = 'hidden';
    textarea.style.height = 'auto';
    const contentHeight = textarea.scrollHeight + borders;
    textarea.style.height = `${Math.min(maximum, Math.max(minimum, contentHeight))}px`;
    textarea.style.overflowY = contentHeight > maximum ? 'auto' : 'hidden';
  };

  createEffect(on(() => props.value, resize));

  onMount(() => {
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      if (width !== nextWidth) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(textarea);
    onCleanup(() => observer.disconnect());
  });

  const paste = (event: ClipboardEvent) => {
    if (props.maxLength === undefined || !event.clipboardData) return;
    event.preventDefault();
    const remaining =
      props.maxLength - textarea.value.length + textarea.selectionEnd - textarea.selectionStart;
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    let inserted = text.slice(0, Math.max(0, remaining));
    const last = inserted.charCodeAt(inserted.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) inserted = inserted.slice(0, -1);
    textarea.setRangeText(inserted, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: inserted }),
    );
  };

  return (
    <textarea
      ref={textarea}
      class={`${inputStyles.input} ${styles.textarea}`}
      rows={1}
      value={props.value}
      maxLength={props.maxLength}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onInput={(event) => {
        props.onInput(event.currentTarget.value);
        resize();
      }}
      onPaste={paste}
    />
  );
}

export default AutosizeTextarea;
