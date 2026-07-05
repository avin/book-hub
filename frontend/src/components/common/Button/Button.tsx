import { type JSX, Show, splitProps } from "solid-js";
import styles from "./Button.module.scss";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonSize = "sm" | "md";

function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconStart?: JSX.Element;
  iconEnd?: JSX.Element;
  iconOnly?: boolean;
}) {
  const [local, buttonProps] = splitProps(props, [
    "children",
    "class",
    "classList",
    "variant",
    "size",
    "loading",
    "disabled",
    "iconStart",
    "iconEnd",
    "iconOnly",
  ]);

  return (
    <button
      {...buttonProps}
      class={`${styles.button} ${local.class ?? ""}`}
      classList={{
        [styles.primary]: (local.variant ?? "primary") === "primary",
        [styles.secondary]: local.variant === "secondary",
        [styles.ghost]: local.variant === "ghost",
        [styles.danger]: local.variant === "danger",
        [styles.link]: local.variant === "link",
        [styles.small]: local.size === "sm",
        [styles.iconOnly]: local.iconOnly,
        [styles.loading]: local.loading,
        ...(local.classList ?? {}),
      }}
      disabled={local.disabled || local.loading}
      aria-busy={local.loading || undefined}
    >
      <Show when={local.loading}>
        <span class={styles.spinner} aria-hidden="true" />
      </Show>
      <Show when={!local.loading && local.iconStart}>
        <span class={styles.icon}>{local.iconStart}</span>
      </Show>
      <Show when={!local.iconOnly}>
        <span class={styles.content}>{local.children}</span>
      </Show>
      <Show when={!local.loading && local.iconEnd}>
        <span class={styles.icon}>{local.iconEnd}</span>
      </Show>
    </button>
  );
}

export default Button;
