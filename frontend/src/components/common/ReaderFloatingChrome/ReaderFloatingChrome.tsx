import { Show, type JSX } from 'solid-js';
import styles from './ReaderFloatingChrome.module.scss';

function ReaderFloatingChrome(props: {
  visible: boolean;
  title?: string;
  headerContent?: JSX.Element;
  actions?: JSX.Element;
  secondaryBar?: JSX.Element;
  onShow: () => void;
}) {
  return (
    <>
      <div class={styles.hoverZone} aria-hidden="true" onPointerEnter={props.onShow} />

      <header
        class={styles.header}
        classList={{ [styles.visible]: props.visible }}
        onPointerEnter={props.onShow}
      >
        <div class={styles.headerBar}>
          <div class={styles.headerContent}>
            {props.headerContent ?? (
              <Show when={props.title}>
                <div class={styles.bookTitle}>{props.title}</div>
              </Show>
            )}
          </div>
          {props.actions}
        </div>
      </header>

      <Show when={props.secondaryBar}>
        {(secondaryBar) => (
          <div
            class={styles.secondaryBar}
            classList={{ [styles.visible]: props.visible }}
            onPointerEnter={props.onShow}
          >
            {secondaryBar()}
          </div>
        )}
      </Show>
    </>
  );
}

export default ReaderFloatingChrome;
