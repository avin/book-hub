import { For, type JSX } from "solid-js";
import styles from "./WidthRuler.module.scss";
import { widthRulerTicks } from "./widthRulerUtils";

function WidthRuler(props: {
  availableWidth: number;
  currentWidth: number;
  maxWidth?: number;
  markerStyles: {
    left: JSX.CSSProperties;
    right: JSX.CSSProperties;
  };
  ariaLabel: string;
  minWidth?: number;
  onRulerRef: (element: HTMLDivElement) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
}) {
  const minWidth = () => props.minWidth ?? 280;

  return (
    <div
      ref={props.onRulerRef}
      class={styles.ruler}
      role="slider"
      aria-label={props.ariaLabel}
      aria-valuemin={String(minWidth())}
      aria-valuemax={String(Math.round(props.maxWidth ?? props.availableWidth))}
      aria-valuenow={String(Math.round(props.currentWidth))}
      tabIndex={0}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
    >
      <For each={widthRulerTicks}>
        {(tick) => (
          <span
            class={styles.rulerTick}
            classList={{
              [styles.majorTick]: tick % 10 === 0,
              [styles.middleTick]: tick % 5 === 0,
              [styles.centerTick]: tick === 0,
            }}
            style={{ left: `${50 + tick * 1.25}%` }}
          />
        )}
      </For>
      <svg class={styles.rulerMarker} style={props.markerStyles.left} viewBox="0 0 28 24" aria-hidden="true">
        <polygon
          points="1.3 1 26.7 1 14 23"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
      <svg class={styles.rulerMarker} style={props.markerStyles.right} viewBox="0 0 28 24" aria-hidden="true">
        <polygon
          points="1.3 1 26.7 1 14 23"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  );
}

export default WidthRuler;
