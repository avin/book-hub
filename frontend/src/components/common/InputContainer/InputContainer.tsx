import { createSignal, JSX, Show } from "solid-js";
import styles from "./InputContainer.module.scss";

export type InputContainerProps = {
  children: JSX.Element;
  label: string;
  htmlFor?: string;
  error?: JSX.Element;
  subtext?: JSX.Element;
  hideErrorText?: boolean;
  endContent?: JSX.Element;
};

function InputContainer(props: InputContainerProps) {
  let rootEl: HTMLDivElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const [filled, setFilled] = createSignal(false);

  const syncFilledState = () => {
    const fields = Array.from(rootEl?.querySelectorAll("input, textarea") ?? []);
    setFilled(fields.some((field) => (field as HTMLInputElement | HTMLTextAreaElement).value.length > 0));
  };

  return (
    <div
      ref={rootEl}
      class={styles.container}
      classList={{
        [styles.focused]: focused(),
        [styles.filled]: filled(),
        [styles.invalid]: Boolean(props.error),
        [styles.withEndContent]: Boolean(props.endContent),
      }}
      onFocusIn={() => {
        setFocused(true);
        syncFilledState();
      }}
      onFocusOut={() => {
        setFocused(false);
        syncFilledState();
      }}
      onInput={syncFilledState}
      onChange={syncFilledState}
    >
      <div class={styles.control}>
        {props.children}
        <label class={styles.label} for={props.htmlFor}>
          {props.label}
        </label>
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
