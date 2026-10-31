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

    if (
      event.pointerType !== 'touch' ||
      !event.isPrimary ||
      touchStart ||
      isInteractiveTarget(event.target)
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
      isInteractiveTarget(event.target) ||
      window.getSelection()?.isCollapsed === false
    ) {
      return;
    }

    const topSector = event.clientY < window.innerHeight * 0.25;
    const bottomSector = event.clientY > window.innerHeight * 0.75;

    if (event.clientX >= (window.innerWidth * 2) / 3 && (topSector || bottomSector)) {
      window.scrollBy({
        top: window.innerHeight * 0.9 * (topSector ? -1 : 1),
        behavior: 'instant',
      });
    } else if (!topSector && !bottomSector) {
      if (visible()) close();
      else show();
    } else {
      return;
    }

    syncFullscreen();
    event.preventDefault();
  };

  const onDocumentClick = (event: MouseEvent) => {
    // A touch can emit a compatibility click after pointerup, even if it was prevented.
    if (ignoreNextDocumentClick || (event as PointerEvent).pointerType === 'touch') {
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

    onCleanup(() => {
      window.removeEventListener('pointermove', onPointerMove);
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
