import { createContext, createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './PageLockerProvider.module.scss';

type PageLocker = {
  isPageLocked: boolean;
  lockPage: () => void;
  unlockPage: () => void;
};

export const PageLockerContext = createContext<PageLocker>();

function PageLockerProvider(props: { children: JSX.Element }) {
  const { t } = useI18n();
  const [isPageLocked, setIsPageLocked] = createSignal(false);
  let focusTarget: HTMLButtonElement | undefined;

  createEffect(() => {
    if (!isPageLocked()) {
      return;
    }

    const keepFocusInLocker = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      event.preventDefault();
      focusTarget?.focus();
    };

    document.addEventListener('keydown', keepFocusInLocker, true);
    requestAnimationFrame(() => focusTarget?.focus());
    onCleanup(() => document.removeEventListener('keydown', keepFocusInLocker, true));
  });

  const pageLocker: PageLocker = {
    get isPageLocked() {
      return isPageLocked();
    },
    lockPage: () => setIsPageLocked(true),
    unlockPage: () => setIsPageLocked(false),
  };

  return (
    <PageLockerContext.Provider value={pageLocker}>
      {props.children}
      <Show when={isPageLocked()}>
        <div class={styles.pageLocker}>
          <button
            ref={focusTarget}
            type="button"
            class={styles.focusTarget}
            aria-label={t('loading')}
          />
        </div>
      </Show>
    </PageLockerContext.Provider>
  );
}

export default PageLockerProvider;
