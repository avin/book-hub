import { createEffect, on, onCleanup, untrack } from 'solid-js';

export function useTagFocus(config: {
  value: () => string[];
  hiddenTags: () => string[];
  disabled: () => boolean;
  isCollapsedOpen: () => boolean;
  isDropdownOpen: () => boolean;
  openCollapsed: () => void;
  closeDropdown: () => void;
  applyTypedInput: () => void;
  removeTag: (tag: string) => void;
  input: () => HTMLInputElement | undefined;
  field: () => HTMLDivElement | undefined;
  menu: () => HTMLDivElement | undefined;
  collapsed: () => HTMLSpanElement | undefined;
}) {
  let movingFocus = false;
  let focusedElement: HTMLElement | undefined;
  let previousValue = untrack(() => [...config.value()]);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const focus = (element: HTMLElement | undefined) => {
    const wasMoving = movingFocus;
    movingFocus = true;
    try {
      element?.focus();
    } finally {
      movingFocus = wasMoving;
    }
  };

  const focusInput = () => focus(config.input());
  const contains = (target: EventTarget | null) =>
    target instanceof Node && (config.field()?.contains(target) || config.menu()?.contains(target));

  const tagButton = (tag: string) =>
    [config.field(), config.menu()]
      .flatMap((element) => [
        ...(element?.querySelectorAll<HTMLButtonElement>('[data-tag-remove]') ?? []),
      ])
      .find((button) => button.dataset.tagRemove === tag);

  const focusTag = (tag: string | undefined) => {
    if (!tag) {
      focusInput();
      return;
    }
    if (config.hiddenTags().includes(tag) && !config.isCollapsedOpen()) config.openCollapsed();
    focus(tagButton(tag) ?? config.input());
  };

  const neighbour = (tag: string, before: string[]) => {
    const index = before.indexOf(tag);
    return [...before.slice(index + 1), ...before.slice(0, index).reverse()].find((candidate) =>
      config.value().includes(candidate),
    );
  };

  const recoverFocus = (before: string[]) => {
    const value = config.value();
    if (
      movingFocus ||
      config.disabled() ||
      !focusedElement ||
      focusedElement === document.activeElement
    )
      return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const tag = focusedElement.dataset.tagRemove;
    if (tag) focusTag(value.includes(tag) ? tag : neighbour(tag, before));
    else focusInput();
  };

  createEffect(
    on(
      () => [config.value(), config.hiddenTags()] as const,
      ([value]) => {
        const before = previousValue;
        previousValue = [...value];
        recoverFocus(before);
      },
    ),
  );

  createEffect(() => {
    if (!config.isDropdownOpen()) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (contains(event.target)) return;
      focusedElement = undefined;
      config.applyTypedInput();
    };
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    onCleanup(() => document.removeEventListener('pointerdown', handleOutsidePointer, true));
  });

  return {
    focusInput,
    dismiss() {
      movingFocus = true;
      try {
        config.closeDropdown();
        focusInput();
      } finally {
        movingFocus = false;
      }
    },
    isMovingFocus: () => movingFocus,
    handleFocusIn(event: FocusEvent) {
      if (event.target instanceof HTMLElement) focusedElement = event.target;
    },
    handleFocusOut(event: FocusEvent) {
      if (movingFocus || contains(event.relatedTarget)) return;
      if (event.relatedTarget === null) {
        // Removing or moving a focused tag can blur it before the DOM update finishes.
        const target = event.target;
        const before = [...previousValue];
        queueMicrotask(() => {
          if (disposed || movingFocus || contains(document.activeElement)) return;
          if (target instanceof Node && !target.isConnected) {
            recoverFocus(before);
            return;
          }
          focusedElement = undefined;
          config.applyTypedInput();
        });
        return;
      }
      focusedElement = undefined;
      config.applyTypedInput();
    },
    handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || config.disabled() || !config.isCollapsedOpen()) return;
      const buttons = [
        ...(config.menu()?.querySelectorAll<HTMLButtonElement>('[data-tag-remove]') ?? []),
      ];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (event.target === config.collapsed() && !event.shiftKey) {
        event.preventDefault();
        focus(buttons[0] ?? config.input());
      } else if (index !== -1) {
        event.preventDefault();
        focus(
          event.shiftKey
            ? (buttons[index - 1] ?? config.collapsed())
            : (buttons[index + 1] ?? config.input()),
        );
      } else if (event.target === config.input()) {
        if (event.shiftKey) {
          event.preventDefault();
          focus(buttons.at(-1) ?? config.collapsed());
        } else {
          config.applyTypedInput();
        }
      }
    },
    removeTag(tag: string, collapsed: boolean) {
      if (config.disabled()) return;
      const before = [...config.value()];
      const hadFocus = tagButton(tag) === document.activeElement;
      movingFocus = true;
      try {
        config.removeTag(tag);
        if (hadFocus) focusTag(neighbour(tag, before));
        else if (!collapsed) focusInput();
      } finally {
        movingFocus = false;
      }
    },
  };
}
