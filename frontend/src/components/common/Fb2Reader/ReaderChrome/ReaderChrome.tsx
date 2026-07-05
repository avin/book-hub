import { Settings } from "lucide-solid";
import { For, type JSX } from "solid-js";
import Button from "@/components/common/Button/Button";
import ReaderFloatingChrome from "@/components/common/ReaderFloatingChrome/ReaderFloatingChrome";
import styles from "./ReaderChrome.module.scss";

function ReaderChrome(props: {
  visible: boolean;
  title: string;
  headerContent?: JSX.Element;
  rulerTicks: number[];
  markerStyles: {
    left: JSX.CSSProperties;
    right: JSX.CSSProperties;
  };
  availableTextWidth: number;
  currentTextWidth: number;
  onShow: () => void;
  onToggleSettings: () => void;
  onRulerRef: (element: HTMLDivElement) => void;
  onRulerPointerDown: (event: PointerEvent) => void;
  onRulerPointerMove: (event: PointerEvent) => void;
  onRulerPointerUp: (event: PointerEvent) => void;
}) {
  return (
    <ReaderFloatingChrome
      visible={props.visible}
      title={props.title}
      headerContent={props.headerContent}
      onShow={props.onShow}
      actions={
        <Button
          variant="secondary"
          type="button"
          iconOnly
          iconStart={<Settings />}
          title="Настройки внешнего вида"
          aria-label="Настройки внешнего вида"
          onClick={props.onToggleSettings}
        />
      }
      secondaryBar={
        <div
          ref={props.onRulerRef}
          class={styles.ruler}
          role="slider"
          aria-label="Максимальная ширина текста"
          aria-valuemin="280"
          aria-valuemax={Math.round(props.availableTextWidth)}
          aria-valuenow={Math.round(props.currentTextWidth)}
          tabIndex={0}
          onPointerDown={props.onRulerPointerDown}
          onPointerMove={props.onRulerPointerMove}
          onPointerUp={props.onRulerPointerUp}
          onPointerCancel={props.onRulerPointerUp}
        >
          <For each={props.rulerTicks}>
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
              fill="rgba(248, 217, 212, 0.86)"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </svg>
          <svg class={styles.rulerMarker} style={props.markerStyles.right} viewBox="0 0 28 24" aria-hidden="true">
            <polygon
              points="1.3 1 26.7 1 14 23"
              fill="rgba(248, 217, 212, 0.86)"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      }
    />
  );
}

export default ReaderChrome;
