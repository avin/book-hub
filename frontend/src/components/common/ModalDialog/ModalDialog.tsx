import { type JSX, onCleanup, onMount } from 'solid-js';

const focusableSelector =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function ModalDialog(props: {
  children: JSX.Element;
  contentClass: string;
  ariaLabel: string;
  overlayClass: string;
  onClose: () => void;
}) {
  let dialogRef: HTMLElement | undefined;
  let pointerStartedOnOverlay = false;

  const handleOverlayPointerDown = (event: PointerEvent) => {
    pointerStartedOnOverlay = event.target === event.currentTarget;
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (pointerStartedOnOverlay && event.target === event.currentTarget) {
      props.onClose();
    }
  };

  onMount(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const initialFocus = dialogRef?.querySelector<HTMLElement>(focusableSelector) ?? dialogRef;

    initialFocus?.focus({ preventScroll: true });

    // Bubble-обработчик на window срабатывает после вложенных Dropdown,
    // которые закрываются по Escape первыми и помечают событие.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        props.onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    });
  });

  return (
    <div
      class={props.overlayClass}
      onPointerDown={handleOverlayPointerDown}
      onClick={handleOverlayClick}
    >
      <section
        ref={dialogRef}
        class={props.contentClass}
        role="dialog"
        aria-modal="true"
        aria-label={props.ariaLabel}
        tabIndex={-1}
      >
        {props.children}
      </section>
    </div>
  );
}

export default ModalDialog;
