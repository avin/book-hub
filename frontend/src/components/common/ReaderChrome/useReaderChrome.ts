import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js';

const headerHideOffset = 128;
const headerShowOffset = 72;
const bottomShowOffset = 88;
const touchToggleClickTimeoutMs = 500;
const defaultHoverOffsets = { hide: headerHideOffset, show: headerShowOffset };

function useReaderChrome(props: {
  keepVisible: Accessor<boolean>;
  onClose: () => void;
  hoverOffsets?: {
    hide: number;
    show: number;
  };
}) {
  let touchToggleClickTimeout: number | undefined;
  let ignoreNextDocumentClick = false;
  const [headerVisible, setHeaderVisible] = createSignal(false);
  const visible = createMemo(() => headerVisible() || props.keepVisible());
  const hoverOffsets = () => props.hoverOffsets ?? defaultHoverOffsets;

  const show = () => setHeaderVisible(true);

  const close = () => {
    setHeaderVisible(false);
    props.onClose();
  };

  const toggleOnTouch = (event: PointerEvent) => {
    if (
      event.pointerType !== 'touch' ||
      event.clientY < window.innerHeight * 0.25 ||
      event.clientY > window.innerHeight * 0.75
    ) {
      return false;
    }

    setHeaderVisible((current) => !current);
    ignoreNextDocumentClick = true;

    if (touchToggleClickTimeout !== undefined) {
      window.clearTimeout(touchToggleClickTimeout);
    }

    touchToggleClickTimeout = window.setTimeout(() => {
      ignoreNextDocumentClick = false;
      touchToggleClickTimeout = undefined;
    }, touchToggleClickTimeoutMs);

    return true;
  };

  const onDocumentClick = () => {
    if (ignoreNextDocumentClick) {
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

  onCleanup(() => {
    if (touchToggleClickTimeout !== undefined) {
      window.clearTimeout(touchToggleClickTimeout);
    }
  });

  return {
    visible,
    show,
    close,
    toggleOnTouch,
    onDocumentClick,
  };
}

export default useReaderChrome;
