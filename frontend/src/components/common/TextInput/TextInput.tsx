import { type JSX, splitProps } from "solid-js";
import styles from "./TextInput.module.scss";

function TextInput(props: JSX.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
}) {
  const [local, inputProps] = splitProps(props, ["class", "classList", "invalid"]);

  return (
    <input
      {...inputProps}
      class={`${styles.input} ${local.class ?? ""}`}
      classList={{
        [styles.invalid]: local.invalid,
        ...(local.classList ?? {}),
      }}
      aria-invalid={local.invalid || undefined}
    />
  );
}

export default TextInput;
