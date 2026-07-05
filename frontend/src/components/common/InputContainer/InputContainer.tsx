import { createSignal, type JSX, Show } from "solid-js";
import styles from "./InputContainer.module.scss";

function InputContainer(props: {
  children: JSX.Element;
  label: string;
  htmlFor?: string;
  error?: JSX.Element;
  subtext?: JSX.Element;
  filled?: boolean;
  hideErrorText?: boolean;
  endContent?: JSX.Element;
}) {
  let rootEl: HTMLDivElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const [filled, setFilled] = createSignal(false);

  const syncFilledState = () => {
    const fields = Array.from(rootEl?.querySelectorAll("input, textarea, select") ?? []);
    const hasFilledField = fields.some((field) => {
      if (field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)) {
        return field.checked;
      }

      return (field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value.length > 0;
    });

    setFilled(hasFilledField || Boolean(rootEl?.querySelector('[data-filled="true"]')));
  };

  return (
    <div
      ref={rootEl}
      class={styles.container}
      classList={{
        [styles.focused]: focused(),
        [styles.filled]: props.filled ?? filled(),
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
