import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js';
import useReaderFullscreen from './useReaderFullscreen';

const headerHideOffset = 128;
const headerShowOffset = 72;
const bottomShowOffset = 88;
const tapMovementThreshold = 12;
const tapDurationMs = 500;
const defaultHoverOffsets = { hide: headerHideOffset, show: headerShowOffset };

function useReaderChrome(props: {
  keepVisible: Accessor<boolean>;
  onClose: () => void;
  hoverOffsets?: {
    hide: number;
    show: number;
  };
}) {
  let ignoreNextDocumentClick = false;
  let touchTapHandled = false;
  let preventNextTouchEnd = false;
  let touchStart:
    | {
        pointerId: number;
        x: number;
        y: number;
        scrollX: number;
        scrollY: number;
        timeStamp: number;
      }
    | undefined;
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const visible = createMemo(() => headerVisible() || props.keepVisible());
  const hoverOffsets = () => props.hoverOffsets ?? defaultHoverOffsets;

  const show = () => setHeaderVisible(true);
  const syncFullscreen = useReaderFullscreen({ visible, onExit: show });

  const close = () => {
    setHeaderVisible(false);
    props.onClose();
  };

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(
      target.closest('a, button, input, textarea, select, [role="button"], [contenteditable]'),
    );

  const onDocumentPointerDown = (event: PointerEvent) => {
    ignoreNextDocumentClick = event.pointerType === 'touch';
    touchTapHandled = false;
    preventNextTouchEnd = false;

    if (
      event.pointerType !== 'touch' ||
      !event.isPrimary ||
      touchStart ||
      isInteractiveTarget(event.target) ||
      window.getSelection()?.isCollapsed === false
    ) {
      touchStart = undefined;
      return;
    }

    touchStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      timeStamp: event.timeStamp,
    };
  };

  const onDocumentPointerCancel = () => {
    touchStart = undefined;
    touchTapHandled = false;
    preventNextTouchEnd = false;
  };

  const onDocumentPointerUp = (event: PointerEvent) => {
    const start = touchStart;
    touchStart = undefined;

    if (
      event.pointerType !== 'touch' ||
      !start ||
      event.pointerId !== start.pointerId ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > tapMovementThreshold ||
      Math.hypot(window.scrollX - start.scrollX, window.scrollY - start.scrollY) >
        tapMovementThreshold ||
      event.timeStamp - start.timeStamp > tapDurationMs ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    const x = event.clientX / window.innerWidth;
    const y = event.clientY / window.innerHeight;
    const centerDistance = Math.abs(x - 0.5) + Math.abs(y - 0.5);

    if (centerDistance <= 0.3 + Number.EPSILON) {
      if (visible()) close();
      else show();
    } else {
      window.scrollBy({
        top: window.innerHeight * 0.9 * (y < 0.5 ? -1 : 1),
        behavior: 'instant',
      });
    }

    window.getSelection()?.removeAllRanges();
    touchTapHandled = true;
    preventNextTouchEnd = true;
    syncFullscreen();
    event.preventDefault();
  };

  const onDocumentClick = (event: MouseEvent) => {
    // A touch can emit a compatibility click after pointerup, even if it was prevented.
    if (ignoreNextDocumentClick || (event as PointerEvent).pointerType === 'touch') {
      if (touchTapHandled) {
        event.preventDefault();
        touchTapHandled = false;
      }
      ignoreNextDocumentClick = false;
      return;
    }

    close();
  };

  createEffect(() => {
    if (props.keepVisible()) {
      show();
    }
  });

  onMount(() => {
    // Cancel the native tap after recognition, preserving scrolling and long-press selection.
    const onTouchEnd = (event: TouchEvent) => {
      if (preventNextTouchEnd) {
        preventNextTouchEnd = false;
        event.preventDefault();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (
        event.pointerType === 'touch' &&
        touchStart?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) >
          tapMovementThreshold
      ) {
        touchStart = undefined;
      }

      if (event.pointerType !== 'mouse') {
        return;
      }

      if (
        event.clientY <= hoverOffsets().show ||
        event.clientY >= window.innerHeight - bottomShowOffset
      ) {
        show();
      } else if (
        event.clientY >= hoverOffsets().hide &&
        !props.keepVisible() &&
        !(document.activeElement instanceof HTMLInputElement)
      ) {
        setHeaderVisible(false);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('touchend', onTouchEnd, { passive: false });

    onCleanup(() => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchend', onTouchEnd);
    });
  });

  return {
    visible,
    show,
    close,
    onDocumentPointerDown,
    onDocumentPointerUp,
    onDocumentPointerCancel,
    onDocumentClick,
  };
}

export default useReaderChrome;
