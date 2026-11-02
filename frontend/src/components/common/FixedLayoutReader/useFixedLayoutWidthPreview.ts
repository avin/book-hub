import { batch, createSignal, onCleanup } from 'solid-js';

export default function useFixedLayoutWidthPreview(options: {
  document: () => HTMLElement | undefined;
  width: () => number;
  widthForOverflow: (value: number) => number;
  onCommit: (value: number) => void;
}) {
  const [active, setActive] = createSignal(false);
  let element: HTMLElement | undefined;

  const clearTransform = () => {
    element?.style.removeProperty('transform');
    element?.style.removeProperty('transform-origin');
    element = undefined;
  };

  onCleanup(clearTransform);

  return {
    active,
    preview(value: number) {
      if (!element) {
        element = options.document();
        if (!element) return;
        const rect = element.getBoundingClientRect();
        // Keep the top of the viewport and its horizontal centre stationary.
        element.style.transformOrigin = `${window.innerWidth / 2 - rect.left}px ${Math.max(0, -rect.top)}px`;
        setActive(true);
      }
      element.style.transform = `scale(${options.widthForOverflow(value) / options.width()})`;
    },
    commit(value: number) {
      batch(() => {
        // Restore layout geometry before the reader captures its scroll anchor.
        clearTransform();
        options.onCommit(value);
        setActive(false);
      });
    },
  };
}
