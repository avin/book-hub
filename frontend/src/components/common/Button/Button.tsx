import { A, RouterContext } from "@solidjs/router";
import { type JSX, Show, splitProps, useContext } from "solid-js";
import styles from "./Button.module.scss";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonSize = "sm" | "md";

type ButtonSharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconStart?: JSX.Element;
  iconEnd?: JSX.Element;
  iconOnly?: boolean;
  fullWidth?: boolean;
  destructive?: boolean;
  class?: string;
  classList?: Record<string, boolean | undefined>;
  children?: JSX.Element;
  disabled?: boolean;
};

type ButtonAsButtonProps = ButtonSharedProps &
  JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ButtonAsLinkProps = ButtonSharedProps &
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "type"> & {
    href: string;
  };

type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function isExternalHref(href: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

function Button(props: ButtonProps) {
  const router = useContext(RouterContext);
  const [local, rest] = splitProps(props as ButtonSharedProps & Record<string, unknown>, [
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
    "fullWidth",
    "destructive",
    "href",
    "onClick",
    "tabIndex",
  ]);

  const href = () => (typeof local.href === "string" ? local.href : undefined);
  const isLink = () => Boolean(href());
  const isDisabled = () => Boolean(local.disabled || local.loading);

  const className = () => `${styles.button} ${local.class ?? ""}`;
  const classList = () => ({
    [styles.primary]: (local.variant ?? "primary") === "primary",
    [styles.secondary]: local.variant === "secondary",
    [styles.ghost]: local.variant === "ghost",
    [styles.danger]: local.variant === "danger",
    [styles.link]: local.variant === "link",
    [styles.small]: local.size === "sm",
    [styles.iconOnly]: local.iconOnly,
    [styles.loading]: local.loading,
    [styles.fullWidth]: local.fullWidth,
    [styles.destructive]: local.destructive,
    [styles.disabled]: isLink() && isDisabled(),
    ...(local.classList ?? {}),
  });

  const content = () => (
    <>
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
    </>
  );

  const linkTabIndex = () => (isDisabled() ? -1 : (local.tabIndex as number | undefined));

  const handleLinkClick: JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent> = (event) => {
    if (isDisabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (typeof local.onClick === "function") {
      local.onClick(event);
    }
  };

  const handleButtonClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    if (typeof local.onClick === "function") {
      local.onClick(event);
    }
  };

  return (
    <Show
      when={isLink()}
      fallback={
        <button
          {...(rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>)}
          class={className()}
          classList={classList()}
          disabled={isDisabled()}
          aria-busy={local.loading || undefined}
          tabIndex={local.tabIndex as number | undefined}
          onClick={handleButtonClick}
        >
          {content()}
        </button>
      }
    >
      <Show
        when={isExternalHref(href()!) || !router}
        fallback={
          <A
            {...(rest as JSX.AnchorHTMLAttributes<HTMLAnchorElement>)}
            href={href()!}
            class={className()}
            classList={classList()}
            aria-busy={local.loading || undefined}
            aria-disabled={isDisabled() || undefined}
            tabIndex={linkTabIndex()}
            onClick={handleLinkClick}
          >
            {content()}
          </A>
        }
      >
        <a
          {...(rest as JSX.AnchorHTMLAttributes<HTMLAnchorElement>)}
          href={href()!}
          class={className()}
          classList={classList()}
          aria-busy={local.loading || undefined}
          aria-disabled={isDisabled() || undefined}
          tabIndex={linkTabIndex()}
          onClick={handleLinkClick}
        >
          {content()}
        </a>
      </Show>
    </Show>
  );
}

export default Button;
