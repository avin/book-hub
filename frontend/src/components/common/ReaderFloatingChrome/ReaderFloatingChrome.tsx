import { onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-solid';
import Button from '@/components/common/Button/Button';
import TextInput from '@/components/common/TextInput/TextInput';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ReaderFloatingChrome.module.scss';

function ReaderFloatingChrome(props: {
  visible: boolean;
  title?: string;
  headerContent?: JSX.Element;
  actions?: JSX.Element;
  secondaryBar?: JSX.Element;
  bottomContent?: JSX.Element;
  searchValue?: string;
  searchCount?: { current: number; total: number };
  onSearchValueChange?: (value: string) => void;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  onSearchOpen?: () => void;
  onClose?: () => void;
  onShow: () => void;
}) {
  const { t } = useI18n();
  let searchInputRef: HTMLInputElement | undefined;
  const showChrome = () => props.onShow();

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
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        focusSearchInput();
        return;
      }

      if (event.key === 'Escape' && props.visible) {
        event.preventDefault();
        props.onClose?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
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
                <Search size={16} aria-hidden="true" />
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
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                iconStart={<X />}
                aria-label={t('closeSearch')}
                title={t('closeSearch')}
                onClick={props.onClose}
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

          <div class={styles.positionContent}>{props.bottomContent}</div>
        </div>
      </footer>
    </>
  );
}

export default ReaderFloatingChrome;
