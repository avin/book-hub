import { type JSX, Show } from "solid-js";
import styles from "./InputContainer.module.scss";

function InputContainer(props: {
  children: JSX.Element;
  label: string;
  htmlFor?: string;
  error?: JSX.Element;
  subtext?: JSX.Element;
  hideErrorText?: boolean;
  endContent?: JSX.Element;
}) {
  return (
    <div class={styles.container} classList={{
      [styles.invalid]: Boolean(props.error),
      [styles.withEndContent]: Boolean(props.endContent),
    }}>
      <label class={styles.label} for={props.htmlFor}>
        {props.label}
      </label>

      <div class={styles.control}>
        {props.children}
        <Show when={props.endContent}>
          <div class={styles.endContent}>{props.endContent}</div>
        </Show>
      </div>

      <Show when={props.subtext && !props.error}>
        <div class={styles.subtext}>{props.subtext}</div>
      </Show>

      <Show when={props.error && !props.hideErrorText}>
        <div class={styles.error}>{props.error}</div>
      </Show>
    </div>
  );
}

export default InputContainer;
