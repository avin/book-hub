import { type JSX } from 'solid-js';

function ModalDialog(props: {
  children: JSX.Element;
  contentClass: string;
  ariaLabel: string;
  overlayClass: string;
  onClose: () => void;
}) {
  let pointerStartedOnOverlay = false;

  const handleOverlayPointerDown = (event: PointerEvent) => {
    pointerStartedOnOverlay = event.target === event.currentTarget;
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (pointerStartedOnOverlay && event.target === event.currentTarget) {
      props.onClose();
    }
  };

  return (
    <div
      class={props.overlayClass}
      onPointerDown={handleOverlayPointerDown}
      onClick={handleOverlayClick}
    >
      <section
        class={props.contentClass}
        role="dialog"
        aria-modal="true"
        aria-label={props.ariaLabel}
      >
        {props.children}
      </section>
    </div>
  );
}

export default ModalDialog;
