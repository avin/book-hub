import { autoUpdate, computePosition, flip, offset, Placement, shift, size } from "@floating-ui/dom";
import { createEffect, JSX, onCleanup, Show } from "solid-js";
import styles from "./Dropdown.module.scss";

export type DropdownProps = {
  trigger: JSX.Element;
  children: JSX.Element;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement?: Placement;
  minWidth?: number;
};

function Dropdown(props: DropdownProps) {
  let rootEl: HTMLDivElement | undefined;
  let referenceEl: HTMLDivElement | undefined;
  let floatingEl: HTMLDivElement | undefined;

  const updatePosition = async () => {
    if (!referenceEl || !floatingEl) {
      return;
    }

    const { x, y } = await computePosition(referenceEl, floatingEl, {
      placement: props.placement ?? "bottom-start",
      middleware: [
        offset(6),
        flip(),
        shift({ padding: 12 }),
        size({
          apply({ rects, elements }) {
            Object.assign(elements.floating.style, {
              minWidth: `${Math.max(props.minWidth ?? 0, rects.reference.width)}px`,
            });
          },
        }),
      ],
    });

    Object.assign(floatingEl.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
  };

  createEffect(() => {
    if (!props.open || !referenceEl || !floatingEl) {
      return;
    }

    const cleanup = autoUpdate(referenceEl, floatingEl, updatePosition);
    updatePosition();
    onCleanup(cleanup);
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootEl && !rootEl.contains(event.target as Node)) {
        props.onOpenChange(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onOpenChange(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <div ref={rootEl} class={styles.dropdown}>
      <div ref={referenceEl}>{props.trigger}</div>
      <Show when={props.open}>
        <div ref={floatingEl} class={styles.content}>
          {props.children}
        </div>
      </Show>
    </div>
  );
}

export default Dropdown;
