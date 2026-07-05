import { Settings } from "lucide-solid";
import { For, type JSX } from "solid-js";
import Button from "@/components/common/Button/Button";
import styles from "./ReaderChrome.module.scss";

function ReaderChrome(props: {
  visible: boolean;
  title: string;
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
    <>
      <header class={styles.header} classList={{ [styles.visible]: props.visible }} onPointerEnter={props.onShow}>
        <div class={styles.headerBar}>
          <div class={styles.bookTitle}>{props.title}</div>
          <Button
            variant="secondary"
            type="button"
            iconOnly
            iconStart={<Settings />}
            title="Настройки внешнего вида"
            aria-label="Настройки внешнего вида"
            onClick={props.onToggleSettings}
          />
        </div>
      </header>

      <div class={styles.rulerBar} classList={{ [styles.visible]: props.visible }} onPointerEnter={props.onShow}>
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
          <span class={styles.rulerMarker} style={props.markerStyles.left} />
          <span class={styles.rulerMarker} style={props.markerStyles.right} />
        </div>
      </div>
    </>
  );
}

export default ReaderChrome;
