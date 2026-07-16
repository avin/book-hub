import { X } from 'lucide-solid';
import { createEffect, For, onCleanup, Show } from 'solid-js';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import { useI18n } from '@/i18n/I18nProvider';
import { createTagSelectionModel } from './tagSelectionModel';
import { useTagOverflow } from './useTagOverflow';
import styles from './TagsSelect.module.scss';

function preventLabelActivation(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function TagBadge(props: {
  tag: string;
  measure?: boolean;
  disabled?: boolean;
  ref?: (element: HTMLSpanElement) => void;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const handleClick = (event: MouseEvent) => {
    preventLabelActivation(event);
    props.onClick?.();
  };

  return (
    <span ref={props.ref} class={styles.badge} data-tag-badge onClick={handleClick}>
      <span class={styles.badgeContent}>
        {props.tag}
        <Show
          when={!props.measure}
          fallback={
            <span class={styles.removeButton} aria-hidden="true">
              <X />
            </span>
          }
        >
          <button
            type="button"
            class={styles.removeButton}
            aria-label={`Remove ${props.tag}`}
            disabled={props.disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (props.disabled) {
                return;
              }

              props.onRemove?.();
            }}
          >
            <X />
          </button>
        </Show>
      </span>
    </span>
  );
}

function TagsSelect(props: {
  value: string[];
  options?: string[];
  onSearchOptions?: (query: string) => string[] | Promise<string[]>;
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  showOptionsOnFocus?: boolean;
}) {
  const { t } = useI18n();
  let inputEl: HTMLInputElement | undefined;
  let dropdownEl: HTMLDivElement | undefined;
  let listContainerEl: HTMLDivElement | undefined;

  const placeholder = () => props.placeholder ?? t('findOrAddTag');
  const selection = createTagSelectionModel({
    value: () => props.value,
    options: () => props.options,
    onSearchOptions: () => props.onSearchOptions,
    onChange: (value) => props.onChange(value),
    disabled: () => Boolean(props.disabled),
    showOptionsOnFocus: () => props.showOptionsOnFocus ?? true,
  });
  const overflow = useTagOverflow({
    value: () => props.value,
    query: selection.query,
    placeholder,
    isDropdownOpen: selection.isDropdownOpen,
    isCollapsedOpen: selection.isCollapsedOpen,
    closeDropdown: selection.closeDropdown,
  });

  const openOptions = () => {
    if (props.disabled || !(props.showOptionsOnFocus ?? true)) {
      return;
    }

    inputEl?.focus();
    selection.openOptions();
  };

  const scrollToFocused = () => {
    const container = listContainerEl;
    if (!container) {
      return;
    }

    const focusedElement = container.querySelector('[data-focused="1"]');
    if (!focusedElement) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = focusedElement.getBoundingClientRect();
    const elementCenter = elementRect.top + elementRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;

    container.scrollTop += elementCenter - containerCenter;
  };

  const handleInputBlur = (event: FocusEvent) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof HTMLElement && dropdownEl?.contains(relatedTarget)) {
      return;
    }

    selection.applyTypedInput();
  };

  const handleContainerClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('[data-tag-badge]') || target.tagName === 'BUTTON') {
      return;
    }

    if (target !== inputEl) {
      event.preventDefault();
      event.stopPropagation();
    }

    inputEl?.focus();
    selection.openOptions();
  };

  createEffect(() => {
    const focusedIndex = selection.focusedOptionIndex();
    if (
      !selection.arrowScrolling() ||
      !selection.isOptionsOpen() ||
      focusedIndex === null ||
      !selection.options().length
    ) {
      return;
    }

    const animationFrameId = requestAnimationFrame(scrollToFocused);
    onCleanup(() => cancelAnimationFrame(animationFrameId));
  });

  return (
    <Dropdown
      open={selection.isDropdownOpen()}
      onOpenChange={selection.handleDropdownOpenChange}
      placement="bottom-start"
      trigger={
        <>
          <div
            ref={overflow.setInputContainer}
            class={styles.inputContainer}
            classList={{ [styles.disabled]: props.disabled }}
            onClick={handleContainerClick}
          >
            <For each={overflow.visibleTags()}>
              {(tag) => (
                <TagBadge
                  tag={tag}
                  disabled={props.disabled}
                  onClick={openOptions}
                  onRemove={() => selection.removeTag(tag)}
                />
              )}
            </For>

            <Show when={overflow.hiddenTags().length > 0}>
              <span
                class={`${styles.badge} ${styles.collapsedBadge}`}
                data-tag-badge
                role="button"
                aria-disabled={props.disabled ? 'true' : undefined}
                tabIndex={props.disabled ? undefined : 0}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (props.disabled) {
                    return;
                  }

                  selection.toggleCollapsedDropdown();
                }}
                onKeyDown={(event) => {
                  if (props.disabled || (event.key !== 'Enter' && event.key !== ' ')) {
                    return;
                  }

                  event.preventDefault();
                  selection.toggleCollapsedDropdown();
                }}
              >
                +{overflow.hiddenTags().length}
              </span>
            </Show>

            <span
              ref={overflow.setMeasureInputWidth}
              class={styles.measureInputWidth}
              aria-hidden="true"
            />
            <input
              ref={inputEl}
              type="text"
              value={selection.query()}
              class={styles.input}
              style={{ width: `${overflow.inputWidth()}px` }}
              placeholder={props.value.length ? undefined : placeholder()}
              disabled={props.disabled}
              onFocus={selection.handleInputFocus}
              onBlur={handleInputBlur}
              onInput={(event) => selection.handleChangeQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Backspace') {
                  if (
                    selection.handleEmptyInputBackspace(
                      event.currentTarget.value,
                      overflow.hiddenTags().length,
                      event.repeat,
                      Date.now(),
                    )
                  ) {
                    event.preventDefault();
                  }
                  return;
                }

                if (event.key === 'ArrowDown' && selection.moveFocusedOption(1)) {
                  event.preventDefault();
                }

                if (event.key === 'ArrowUp' && selection.moveFocusedOption(-1)) {
                  event.preventDefault();
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  selection.applyCurrentInput();
                }
              }}
            />
          </div>

          <div class={styles.measureContainer} aria-hidden="true">
            <For each={props.value}>
              {(tag, index) => (
                <TagBadge
                  tag={tag}
                  measure
                  ref={(element) => overflow.setTagMeasure(index(), element)}
                />
              )}
            </For>
            <span ref={overflow.setCollapsedBadgeMeasure} class={styles.badge} />
          </div>
        </>
      }
    >
      <Show
        when={selection.isCollapsedOpen()}
        fallback={
          <div
            ref={dropdownEl}
            class={styles.menu}
            style={{ width: `${overflow.dropdownWidth() ?? 0}px` }}
          >
            <div ref={listContainerEl} class={styles.optionsList}>
              <For each={selection.options()}>
                {(option, index) => (
                  <button
                    type="button"
                    class={styles.option}
                    data-focused={selection.focusedOptionIndex() === index() ? '1' : undefined}
                    classList={{
                      [styles.focusedOption]: selection.focusedOptionIndex() === index(),
                    }}
                    onClick={() => selection.addTag(option)}
                    onMouseEnter={() => selection.focusOption(index())}
                  >
                    <span>{option}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        }
      >
        <div
          ref={dropdownEl}
          class={styles.collapsedTagsDropdownArea}
          style={{ width: `${overflow.dropdownWidth() ?? 0}px` }}
        >
          <For each={overflow.hiddenTags()}>
            {(tag) => (
              <TagBadge
                tag={tag}
                disabled={props.disabled}
                onRemove={() => selection.removeTag(tag)}
              />
            )}
          </For>
        </div>
      </Show>
    </Dropdown>
  );
}

export default TagsSelect;
