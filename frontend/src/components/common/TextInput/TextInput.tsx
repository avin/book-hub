import { JSX, splitProps } from "solid-js";
import styles from "./TextInput.module.scss";

export type TextInputProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

function TextInput(props: TextInputProps) {
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
