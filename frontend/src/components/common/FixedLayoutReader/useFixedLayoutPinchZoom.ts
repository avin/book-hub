import { onCleanup, onMount } from 'solid-js';
import { clampFixedLayoutPageWidthOverflow } from './fixedLayoutPageSettings';

export default function useFixedLayoutPinchZoom(options: {
  root: () => HTMLElement | undefined;
  document: () => HTMLElement | undefined;
  overflow: () => number;
  width: () => number;
  widthForOverflow: (value: number) => number;
  preview: (value: number) => void;
  commit: (value: number) => void;
}) {
  let gesture:
    | { distance: number; width: number; initial: number; value: number; active: boolean }
    | undefined;
  const distance = (touches: TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  onMount(() => {
    const root = options.root();
    if (!root) return;

    const start = (event: TouchEvent) => {
      if (gesture || event.touches.length !== 2 || !options.document()) return;
      if (
        !Array.from(event.touches).every((touch) =>
          options.document()?.contains(touch.target as Node),
        )
      )
        return;
      const initialDistance = distance(event.touches);
      if (initialDistance < 1) return;
      gesture = {
        distance: initialDistance,
        width: options.width(),
        initial: options.overflow(),
        value: options.overflow(),
        active: false,
      };
      if (event.cancelable) event.preventDefault();
    };
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 2) return;
      if (event.cancelable) event.preventDefault();
      const currentDistance = distance(event.touches);
      if (!gesture.active && Math.abs(currentDistance - gesture.distance) < 8) return;
      const targetWidth = (gesture.width * currentDistance) / gesture.distance;
      const minWidth = options.widthForOverflow(1);
      const maxWidth = options.widthForOverflow(80);
      const value =
        targetWidth < minWidth ? 0 : 1 + ((targetWidth - minWidth) * 79) / (maxWidth - minWidth);
      gesture.value = clampFixedLayoutPageWidthOverflow(value);
      gesture.active = true;
      options.preview(gesture.value);
    };
    const end = (event: TouchEvent) => {
      if (!gesture || event.touches.length >= 2) return;
      if (gesture.active)
        options.commit(event.type === 'touchcancel' ? gesture.initial : gesture.value);
      gesture = undefined;
    };

    root.addEventListener('touchstart', start, { passive: false });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    onCleanup(() => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', end);
    });
  });
}
