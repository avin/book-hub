import { onCleanup, type JSX } from 'solid-js';
import styles from './RangeInput.module.scss';

function RangeInput(props: {
  min: number | string;
  max: number | string;
  step?: number | string;
  value: number;
  disabled?: boolean;
  'aria-label'?: string;
  onInput: JSX.EventHandler<HTMLInputElement, InputEvent>;
  onChange?: () => void;
  onAdjustStart?: () => void;
  onAdjustEnd?: () => void;
}) {
  let input!: HTMLInputElement;
  let gesture:
    | {
        pointerId: number;
        x: number;
        y: number;
        value: number;
        touch: boolean;
        adjusting: boolean;
        changed: boolean;
      }
    | undefined;

  const finish = () => {
    const current = gesture;
    gesture = undefined;
    if (!current?.adjusting) return;
    if (current.changed) input.dispatchEvent(new Event('change', { bubbles: true }));
    props.onAdjustEnd?.();
  };

  const begin = () => {
    if (!gesture) return;
    gesture.adjusting = true;
    if (!gesture.touch) input.focus({ preventScroll: true });
    props.onAdjustStart?.();
  };

  const update = (event: PointerEvent) => {
    if (!gesture) return;
    const rect = input.getBoundingClientRect();
    const thumbSize = Number.parseFloat(
      getComputedStyle(input).getPropertyValue('--range-thumb-size'),
    );
    const width = Math.max(1, rect.width - thumbSize);
    const min = Number(props.min);
    const max = Number(props.max);
    const next = gesture.touch
      ? gesture.value + ((event.clientX - gesture.x) / width) * (max - min)
      : min + ((event.clientX - rect.left - thumbSize / 2) / width) * (max - min);
    const previous = input.value;
    input.value = String(next);
    // Let the native input apply its min, max and step constraints.
    input.stepUp(0);
    if (input.value !== previous) {
      gesture.changed = true;
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (gesture) {
      finish();
      return;
    }
    if (props.disabled || !event.isPrimary || event.button !== 0) return;
    const touch = event.pointerType !== 'mouse';
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      value: input.valueAsNumber,
      touch,
      adjusting: false,
      changed: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (!touch) {
      event.preventDefault();
      begin();
      update(event);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.adjusting) {
      const dx = Math.abs(event.clientX - gesture.x);
      const dy = Math.abs(event.clientY - gesture.y);
      if (Math.max(dx, dy) < 10) return;
      if (dy >= dx) {
        gesture = undefined;
        return;
      }
      begin();
    }
    update(event);
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId) finish();
  };

  onCleanup(finish);

  return (
    <div
      class={styles.rangeInput}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      <input
        ref={input}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        aria-label={props['aria-label']}
        onInput={(event) => props.onInput(event)}
        onChange={() => props.onChange?.()}
      />
    </div>
  );
}

export default RangeInput;
