import { createSignal } from 'solid-js';

export function createContextMenu(onOpen: () => void) {
  const [position, setPosition] = createSignal<{ x: number; y: number } | null>(null);

  return {
    position,
    close: () => setPosition(null),
    handleContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setPosition({ x: event.clientX, y: event.clientY });
      onOpen();
    },
  };
}
