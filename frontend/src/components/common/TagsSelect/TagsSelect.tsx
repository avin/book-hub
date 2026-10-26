import { X } from 'lucide-solid';
import { createEffect, createUniqueId, For, onCleanup, Show } from 'solid-js';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import { useI18n } from '@/i18n/I18nProvider';
import { createTagSelectionModel } from './tagSelectionModel';
import { MAX_TAG_LENGTH } from './tagUtils';
import { useTagOverflow } from './useTagOverflow';
import { useTagFocus } from './useTagFocus';
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
  const { t } = useI18n();
  const handleClick = (event: MouseEvent) => {
    preventLabelActivation(event);
    props.onClick?.();
  };

  return (
    <span
      ref={props.ref}
      class={styles.badge}
      title={props.tag}
      data-tag-badge
      onClick={handleClick}
    >
      <span class={styles.badgeContent}>
        <span class={styles.tagText}>{props.tag}</span>
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
            aria-label={`${t('removeTag')} ${props.tag}`}
            data-tag-remove={props.tag}
            disabled={props.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.repeat && (event.key === 'Enter' || event.key === ' '))
                event.preventDefault();
            }}
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
  let fieldEl: HTMLDivElement | undefined;
  let collapsedEl: HTMLSpanElement | undefined;
  let isComposing = false;
  let compositionRange: { prefix: string; suffix: string } | undefined;
  const listId = createUniqueId();

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
  const focus = useTagFocus({
    value: () => props.value,
    hiddenTags: overflow.hiddenTags,
    disabled: () => Boolean(props.disabled),
    isCollapsedOpen: selection.isCollapsedOpen,
    isDropdownOpen: selection.isDropdownOpen,
    openCollapsed: selection.openCollapsedDropdown,
    closeDropdown: selection.closeDropdown,
    applyTypedInput: selection.applyTypedInput,
    removeTag: selection.removeTag,
    input: () => inputEl,
    field: () => fieldEl,
    menu: () => dropdownEl,
    collapsed: () => collapsedEl,
  });
  const focusInput = focus.focusInput;

  const openOptions = () => {
    if (props.disabled || !(props.showOptionsOnFocus ?? true)) {
      return;
    }

    focusInput();
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

  const handleContainerClick = (event: MouseEvent) => {
    if (props.disabled) return;
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest('[data-tag-badge]') || target.tagName === 'BUTTON') {
      return;
    }

    if (target !== inputEl) {
      event.preventDefault();
      event.stopPropagation();
    }

    focusInput();
    selection.openOptions();
  };

  const removeTag = (tag: string, collapsed = false) => focus.removeTag(tag, collapsed);

  const handleKeyDown = (event: KeyboardEvent) => {
    focus.handleKeyDown(event);
    if (event.key !== 'Escape' || isComposing || event.isComposing) return;
    if (!selection.isDropdownOpen() && !selection.wantsOptions()) return;
    event.preventDefault();
    event.stopPropagation();
    focus.dismiss();
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
            ref={(element) => {
              fieldEl = element;
              overflow.setInputContainer(element);
            }}
            class={styles.inputContainer}
            classList={{ [styles.disabled]: props.disabled }}
            onClick={handleContainerClick}
            onFocusIn={focus.handleFocusIn}
            onFocusOut={focus.handleFocusOut}
            onKeyDown={handleKeyDown}
          >
            <For each={overflow.visibleTags()}>
              {(tag) => (
                <TagBadge
                  tag={tag}
                  disabled={props.disabled}
                  onClick={openOptions}
                  onRemove={() => removeTag(tag)}
                />
              )}
            </For>

            <Show when={overflow.hiddenTags().length > 0}>
              <span
                ref={collapsedEl}
                class={`${styles.badge} ${styles.collapsedBadge}`}
                data-tag-badge
                role="button"
                aria-expanded={selection.isCollapsedOpen()}
                aria-controls={selection.isCollapsedOpen() ? `${listId}-selected` : undefined}
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
                  if (event.repeat) return;
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
              role="combobox"
              aria-label={t('tags')}
              aria-autocomplete="list"
              aria-describedby={`${listId}-limits`}
              aria-expanded={selection.isOptionsOpen()}
              aria-controls={selection.isOptionsOpen() ? listId : undefined}
              aria-activedescendant={
                selection.isOptionsOpen() && selection.focusedOptionIndex() !== null
                  ? `${listId}-${selection.focusedOptionIndex()}`
                  : undefined
              }
              autocomplete="off"
              value={selection.query()}
              class={styles.input}
              style={{ width: `${overflow.inputWidth()}px` }}
              placeholder={
                selection.isAtLimit()
                  ? t('tagLimitReached')
                  : props.value.length
                    ? undefined
                    : placeholder()
              }
              title={selection.isAtLimit() ? t('tagLimitReached') : t('tagLengthLimit')}
              readOnly={selection.isAtLimit()}
              disabled={props.disabled}
              onFocus={() => {
                if (!focus.isMovingFocus()) selection.handleInputFocus();
              }}
              onBeforeInput={(event) => {
                if (isComposing || event.isComposing || !event.data) return;
                const input = event.currentTarget;
                const remaining =
                  MAX_TAG_LENGTH -
                  Array.from(
                    input.value.slice(0, input.selectionStart ?? 0) +
                      input.value.slice(input.selectionEnd ?? 0),
                  ).length;
                if (Array.from(event.data).length > remaining) {
                  event.preventDefault();
                  const inserted = Array.from(event.data).slice(0, Math.max(0, remaining)).join('');
                  if (!inserted) return;
                  input.setRangeText(
                    inserted,
                    input.selectionStart ?? 0,
                    input.selectionEnd ?? 0,
                    'end',
                  );
                  selection.handleChangeQuery(input.value);
                }
              }}
              onPaste={(event) => {
                if (props.disabled || selection.isAtLimit() || !event.clipboardData) return;
                event.preventDefault();
                const input = event.currentTarget;
                const start = input.selectionStart ?? 0;
                const end = input.selectionEnd ?? 0;
                const remaining =
                  MAX_TAG_LENGTH -
                  Array.from(input.value.slice(0, start) + input.value.slice(end)).length;
                const inserted = Array.from(
                  event.clipboardData.getData('text/plain').replace(/[\r\n]/g, ''),
                )
                  .slice(0, Math.max(0, remaining))
                  .join('');
                input.setRangeText(inserted, start, end, 'end');
                selection.handleChangeQuery(input.value);
              }}
              onInput={(event) => {
                if (!isComposing) {
                  event.currentTarget.value = Array.from(event.currentTarget.value)
                    .slice(0, MAX_TAG_LENGTH)
                    .join('');
                }
                selection.handleChangeQuery(event.currentTarget.value);
              }}
              onCompositionStart={(event) => {
                isComposing = true;
                const input = event.currentTarget;
                compositionRange = {
                  prefix: input.value.slice(0, input.selectionStart ?? 0),
                  suffix: input.value.slice(input.selectionEnd ?? 0),
                };
                selection.resetBackspace();
              }}
              onCompositionEnd={(event) => {
                isComposing = false;
                const input = event.currentTarget;
                if (compositionRange && Array.from(input.value).length > MAX_TAG_LENGTH) {
                  const { prefix, suffix } = compositionRange;
                  const remaining = MAX_TAG_LENGTH - Array.from(prefix + suffix).length;
                  const inserted = Array.from(
                    input.value.slice(prefix.length, input.value.length - suffix.length),
                  )
                    .slice(0, Math.max(0, remaining))
                    .join('');
                  input.value = prefix + inserted + suffix;
                  input.setSelectionRange(
                    prefix.length + inserted.length,
                    prefix.length + inserted.length,
                  );
                }
                compositionRange = undefined;
                selection.handleChangeQuery(input.value);
              }}
              onKeyDown={(event) => {
                if (isComposing || event.isComposing || event.keyCode === 229) {
                  event.stopImmediatePropagation();
                  return;
                }
                if (props.disabled) return;
                if (event.key !== 'Backspace') selection.resetBackspace();
                if (event.ctrlKey || event.metaKey || event.altKey) {
                  selection.resetBackspace();
                  return;
                }
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

          <span id={`${listId}-limits`} class={styles.inputHint}>
            {selection.isAtLimit() ? t('tagLimitReached') : t('tagLengthLimit')}
          </span>

          <div class={styles.measureContainer} aria-hidden="true">
            <For each={props.value}>
              {(tag) => (
                <TagBadge
                  tag={tag}
                  measure
                  ref={(element) => overflow.setTagMeasure(tag, element)}
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
            onFocusIn={focus.handleFocusIn}
            onFocusOut={focus.handleFocusOut}
            onKeyDown={handleKeyDown}
          >
            <div
              ref={listContainerEl}
              id={listId}
              role="listbox"
              aria-label={t('tags')}
              class={styles.optionsList}
            >
              <For each={selection.options()}>
                {(option, index) => (
                  <button
                    type="button"
                    id={`${listId}-${index()}`}
                    role="option"
                    aria-selected={selection.focusedOptionIndex() === index()}
                    tabIndex={-1}
                    class={styles.option}
                    data-focused={selection.focusedOptionIndex() === index() ? '1' : undefined}
                    classList={{
                      [styles.focusedOption]: selection.focusedOptionIndex() === index(),
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      selection.addTag(option);
                      focusInput();
                    }}
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
          id={`${listId}-selected`}
          role="group"
          aria-label={t('selectedTags')}
          class={styles.collapsedTagsDropdownArea}
          style={{ width: `${overflow.dropdownWidth() ?? 0}px` }}
          onFocusIn={focus.handleFocusIn}
          onFocusOut={focus.handleFocusOut}
          onKeyDown={handleKeyDown}
        >
          <For each={overflow.hiddenTags()}>
            {(tag) => (
              <TagBadge tag={tag} disabled={props.disabled} onRemove={() => removeTag(tag, true)} />
            )}
          </For>
        </div>
      </Show>
    </Dropdown>
  );
}

export default TagsSelect;
