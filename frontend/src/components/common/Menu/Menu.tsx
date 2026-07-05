import { For, JSX, Show } from "solid-js";
import styles from "./Menu.module.scss";

export type MenuSeparator<TId = string> = {
  type: "separator";
  id?: TId;
  key?: string;
};

export type MenuButton<TId = string> = {
  type?: "button";
  id?: TId;
  key?: string;
  label: JSX.Element;
  disabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  iconStart?: JSX.Element;
  iconEnd?: JSX.Element;
  onClick?: () => void;
  onMouseEnter?: () => void;
};

export type MenuLink<TId = string> = {
  type: "link";
  id?: TId;
  key?: string;
  label: JSX.Element;
  href: string;
  disabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  iconStart?: JSX.Element;
  iconEnd?: JSX.Element;
  onClick?: () => void;
  onMouseEnter?: () => void;
};

export type MenuCategory<TId = string> = {
  type: "category";
  id?: TId;
  key?: string;
  label: JSX.Element;
  items: MenuItem<TId>[];
};

export type MenuActionItem<TId = string> = MenuButton<TId> | MenuLink<TId>;
export type MenuItem<TId = string> =
  | MenuSeparator<TId>
  | MenuButton<TId>
  | MenuLink<TId>
  | MenuCategory<TId>;

export type MenuProps<TId = string> = {
  items: MenuItem<TId>[];
  class?: string;
  withHoverEffect?: boolean;
  onClick?: (menuItem: MenuActionItem<TId>) => void;
};

function getItemKey<TId>(item: MenuItem<TId>, index: number) {
  return String(item.key ?? item.id ?? index);
}

function getItemStyle(depth: number) {
  return { "--menu-depth": String(depth) } as JSX.CSSProperties;
}

function Menu<TId = string>(props: MenuProps<TId>) {
  const renderItems = (items: MenuItem<TId>[], depth: number): JSX.Element => (
    <For each={items}>
      {(item, index) => {
        const key = getItemKey(item, index());

        if (item.type === "category") {
          return (
            <>
              <div class={styles.category} style={getItemStyle(depth)} role="presentation">
                {item.label}
              </div>
              {renderItems(item.items, depth + 1)}
            </>
          );
        }

        if (item.type === "separator") {
          return <div class={styles.separator} role="separator" />;
        }

        const activateItem = () => {
          if (item.disabled) {
            return;
          }

          props.onClick?.(item);
          item.onClick?.();
        };

        const classList = {
          [styles.focused]: item.focused,
          [styles.selected]: item.selected,
        };

        const content = (
          <>
            <Show when={item.iconStart}>
              <span class={styles.icon}>{item.iconStart}</span>
            </Show>
            <span class={styles.label}>{item.label}</span>
            <Show when={item.iconEnd}>
              <span class={styles.icon}>{item.iconEnd}</span>
            </Show>
          </>
        );

        return (
          <div class={styles.itemWrapper} data-key={key}>
            <Show
              when={item.type === "link"}
              fallback={
                <button
                  type="button"
                  class={styles.item}
                  classList={classList}
                  style={getItemStyle(depth)}
                  disabled={item.disabled}
                  role="menuitem"
                  aria-disabled={item.disabled || undefined}
                  aria-current={item.selected ? "true" : undefined}
                  onClick={activateItem}
                  onMouseEnter={item.onMouseEnter}
                >
                  {content}
                </button>
              }
            >
              <a
                class={styles.item}
                classList={classList}
                style={getItemStyle(depth)}
                href={(item as MenuLink<TId>).href}
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                aria-current={item.selected ? "true" : undefined}
                onClick={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                  }

                  activateItem();
                }}
                onMouseEnter={item.onMouseEnter}
              >
                {content}
              </a>
            </Show>
          </div>
        );
      }}
    </For>
  );

  return (
    <div
      class={`${styles.menu} ${props.class ?? ""}`}
      classList={{ [styles.withHoverEffect]: props.withHoverEffect ?? true }}
      role="menu"
    >
      {renderItems(props.items, 0)}
    </div>
  );
}

export default Menu;
