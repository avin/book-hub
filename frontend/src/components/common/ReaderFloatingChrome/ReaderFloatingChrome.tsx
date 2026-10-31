import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ChevronDown, ChevronUp, PanelRight, Search, X } from 'lucide-solid';
import Button from '@/components/common/Button/Button';
import TextInput from '@/components/common/TextInput/TextInput';
import { useI18n } from '@/i18n/I18nProvider';
import {
  getMinimalScrollbarsPreference,
  setMinimalScrollbarsPreference,
} from '@/storage/browserPreferences';
import styles from './ReaderFloatingChrome.module.scss';

function ReaderFloatingChrome(props: {
  visible: boolean;
  title?: string;
  headerContent?: JSX.Element;
  actions?: JSX.Element;
  secondaryBar?: JSX.Element;
  bottomContent?: JSX.Element;
  scrollbarBackground?: string;
  searchValue?: string;
  searchCount?: { current: number; total: number };
  searchUnavailableMessage?: string;
  onSearchValueChange?: (value: string) => void;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  onSearchOpen?: () => void;
  onClose?: () => void;
  onShow: () => void;
}) {
  const { t } = useI18n();
  const [minimalScrollbars, setMinimalScrollbars] = createSignal(getMinimalScrollbarsPreference());
  let searchInputRef: HTMLInputElement | undefined;
  const showChrome = () => props.onShow();

  createEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(styles.minimalScrollbars, minimalScrollbars());
    root.style.setProperty(
      '--reader-scrollbar-background',
      props.scrollbarBackground ?? 'var(--surface-sunken)',
    );
  });

  onCleanup(() => {
    document.documentElement.classList.remove(styles.minimalScrollbars);
    document.documentElement.style.removeProperty('--reader-scrollbar-background');
  });

  const toggleScrollbars = () => {
    const enabled = !minimalScrollbars();
    setMinimalScrollbars(enabled);
    setMinimalScrollbarsPreference(enabled);
    showChrome();
  };

  const focusSearchInput = () => {
    props.onSearchOpen?.();
    showChrome();
    requestAnimationFrame(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
    });
  };

  const handleSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && props.onSearchNext) {
      event.preventDefault();
      props.onSearchNext();
    }
  };

  onMount(() => {
    const isFindShortcut = (event: KeyboardEvent) =>
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      (event.key.toLowerCase() === 'f' || event.code === 'KeyF');

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }

      if (isFindShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        focusSearchInput();
        return;
      }

      if (event.key === 'Escape' && props.visible) {
        event.preventDefault();
        props.onClose?.();
      }
    };

    // Capture phase: browser Find opens before bubble listeners run.
    window.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, { capture: true }));
  });

  const searchCount = () => {
    const count = props.searchCount;

    return count && count.total > 0 ? `${count.current}/${count.total}` : '0/0';
  };

  return (
    <>
      <div class={styles.topHoverZone} aria-hidden="true" onPointerEnter={showChrome} />
      <div class={styles.bottomHoverZone} aria-hidden="true" onPointerEnter={showChrome} />

      <header
        class={styles.header}
        classList={{ [styles.visible]: props.visible }}
        data-testid="reader-floating-header"
        data-visible={props.visible}
        onPointerEnter={showChrome}
      >
        <div class={styles.headerBar}>
          <div class={styles.headerContent}>
            {props.headerContent ?? (
              <Show when={props.title}>
                <div class={styles.bookTitle}>{props.title}</div>
              </Show>
            )}
          </div>
          {props.actions}
        </div>

        <Show when={props.secondaryBar}>
          {(secondaryBar) => (
            <div class={styles.secondaryBar} onPointerEnter={showChrome}>
              {secondaryBar()}
            </div>
          )}
        </Show>
      </header>

      <footer
        class={styles.footer}
        classList={{ [styles.visible]: props.visible }}
        data-testid="reader-floating-footer"
        data-visible={props.visible}
      >
        <div class={styles.footerBar}>
          <Show when={props.searchValue !== undefined}>
            <div class={styles.searchControls} role="search">
              <div class={styles.searchInputWrap}>
                <Search class={styles.searchIcon} size={16} aria-hidden="true" />
                <TextInput
                  ref={searchInputRef}
                  class={styles.searchInput}
                  type="search"
                  value={props.searchValue ?? ''}
                  placeholder={t('bookSearch')}
                  aria-label={t('bookSearch')}
                  onInput={(event) => props.onSearchValueChange?.(event.currentTarget.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={handleSearchKeyDown}
                />
                <Show when={props.searchValue !== undefined && props.searchValue !== ''}>
                  <button
                    type="button"
                    class={styles.searchClear}
                    aria-label={t('clearSearch')}
                    title={t('clearSearch')}
                    onClick={() => props.onSearchValueChange?.('')}
                  >
                    <X />
                  </button>
                </Show>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                iconStart={<ChevronUp />}
                aria-label={t('findPrevious')}
                title={t('findPrevious')}
                disabled={!props.onSearchPrevious}
                onClick={props.onSearchPrevious}
              />
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                iconStart={<ChevronDown />}
                aria-label={t('findNext')}
                title={t('findNext')}
                disabled={!props.onSearchNext}
                onClick={props.onSearchNext}
              />
              <span
                class={styles.searchCount}
                classList={{ [styles.searchCountEmpty]: !props.searchCount?.total }}
                aria-live="polite"
              >
                {searchCount()}
              </span>
            </div>
          </Show>
          <Show when={props.searchValue === undefined && props.searchUnavailableMessage}>
            <span class={styles.searchCount} role="status">
              {props.searchUnavailableMessage}
            </span>
          </Show>

          <div class={styles.positionContent}>{props.bottomContent}</div>
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            type="button"
            iconStart={<PanelRight />}
            aria-label={t('minimalScrollbars')}
            title={t('minimalScrollbars')}
            aria-pressed={minimalScrollbars()}
            onClick={toggleScrollbars}
          />
        </div>
      </footer>
    </>
  );
}

export default ReaderFloatingChrome;
