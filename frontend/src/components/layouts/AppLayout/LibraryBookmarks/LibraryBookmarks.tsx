import { useNavigate } from '@solidjs/router';
import { Bookmark, Plus, X } from 'lucide-solid';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createLibraryBookmarks, type LibraryBookmark } from '@/api/libraryBookmarks';
import Button from '@/components/common/Button/Button';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import {
  buildLibraryListStateUrl,
  getLastLibraryListState,
  rememberLibraryListState,
  setLibraryBookmarkApplication,
} from '@/components/pages/LibraryPage/libraryListState';
import { useI18n } from '@/i18n/I18nProvider';
import CreateBookmarkDialog from './CreateBookmarkDialog/CreateBookmarkDialog';
import styles from './LibraryBookmarks.module.scss';

function LibraryBookmarks() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { settings, mutation, bookmarks } = createLibraryBookmarks();
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [deleting, setDeleting] = createSignal<LibraryBookmark>();
  const [revealed, setRevealed] = createSignal<string>();
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  const clearPress = () => clearTimeout(pressTimer);
  onCleanup(clearPress);
  onMount(() => {
    const hide = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[data-bookmark-id]') ||
        event.target.closest('[data-bookmark-id]')?.getAttribute('data-bookmark-id') !== revealed()
      )
        setRevealed(undefined);
    };
    document.addEventListener('pointerdown', hide);
    onCleanup(() => document.removeEventListener('pointerdown', hide));
  });
  const closeCreation = () => {
    setCreating(false);
    mutation.reset();
  };
  const openCreation = () => {
    mutation.reset();
    setCreating(true);
  };
  const apply = (bookmark: LibraryBookmark) => {
    const state = {
      ...getLastLibraryListState(),
      search: bookmark.search,
      searchField: bookmark.searchField,
      tags: [...bookmark.tags],
      favoriteFilter: 'all' as const,
    };
    rememberLibraryListState(state);
    setLibraryBookmarkApplication(state);
    setMobileOpen(false);
    navigate(buildLibraryListStateUrl(state, { pathname: '/library', search: '', hash: '' }));
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const list = () => (
    <>
      <div class={styles.list} aria-label={t('bookmarks')}>
        <For each={bookmarks()}>
          {(bookmark) => (
            <div
              class={styles.row}
              data-bookmark-id={bookmark.id}
              classList={{ [styles.revealed]: revealed() === bookmark.id }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                class={styles.link}
                title={bookmark.name}
                onPointerDown={(event) => {
                  longPressed = false;
                  if (event.pointerType === 'mouse') return;
                  clearPress();
                  pressTimer = setTimeout(() => {
                    longPressed = true;
                    setRevealed(bookmark.id);
                  }, 550);
                }}
                onPointerUp={clearPress}
                onPointerCancel={clearPress}
                onPointerMove={clearPress}
                onClick={() => {
                  clearPress();
                  if (longPressed) {
                    longPressed = false;
                    return;
                  }
                  apply(bookmark);
                }}
              >
                <span>{bookmark.name}</span>
              </button>
              <button
                type="button"
                class={styles.remove}
                aria-label={`${t('deleteBookmark')} ${bookmark.name}`}
                onClick={() => {
                  mutation.reset();
                  setDeleting(bookmark);
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={settings.isError}>
        <p role="alert">{t('requestFailedTryAgain')}</p>
        <Button variant="ghost" onClick={() => void settings.refetch()}>
          {t('retry')}
        </Button>
      </Show>
      <Button
        class={styles.create}
        type="button"
        variant="ghost"
        disabled={!settings.isSuccess || mutation.isPending}
        iconStart={<Plus />}
        onClick={openCreation}
      >
        {t('createBookmark')}
      </Button>
    </>
  );
  return (
    <>
      <div class={styles.desktop}>{!mobileOpen() && list()}</div>
      <Button
        class={styles.mobile}
        type="button"
        variant="ghost"
        iconOnly
        iconStart={<Bookmark />}
        aria-label={t('bookmarks')}
        title={t('bookmarks')}
        onClick={() => setMobileOpen(true)}
      />
      <Show when={mobileOpen() && !creating() && !deleting()}>
        <ModalDialog
          ariaLabel={t('bookmarks')}
          overlayClass={styles.overlay}
          contentClass={`${styles.dialog} ${styles.listDialog}`}
          onClose={() => setMobileOpen(false)}
        >
          <h2>{t('bookmarks')}</h2>
          {list()}
          <Button variant="ghost" onClick={() => setMobileOpen(false)}>
            {t('close')}
          </Button>
        </ModalDialog>
      </Show>
      <Show when={creating()}>
        <CreateBookmarkDialog
          saving={mutation.isPending}
          error={mutation.isError}
          onClose={closeCreation}
          onSave={(bookmark) =>
            mutation.mutate(
              { libraryBookmarks: [...bookmarks(), bookmark] },
              { onSuccess: closeCreation },
            )
          }
        />
      </Show>
      <Show when={deleting()}>
        {(bookmark) => (
          <ModalDialog
            ariaLabel={t('deleteBookmark')}
            overlayClass={styles.overlay}
            contentClass={styles.dialog}
            onClose={() => {
              if (!mutation.isPending) setDeleting(undefined);
            }}
          >
            <h2>{t('deleteBookmark')}?</h2>
            <p class={styles.fullName}>{bookmark().name}</p>
            <Show when={mutation.isError}>
              <p role="alert">{t('requestFailedTryAgain')}</p>
            </Show>
            <div class={styles.actions}>
              <Button
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => setDeleting(undefined)}
              >
                {t('no')}
              </Button>
              <Button
                loading={mutation.isPending}
                onClick={() =>
                  mutation.mutate(
                    { libraryBookmarks: bookmarks().filter((item) => item.id !== bookmark().id) },
                    {
                      onSuccess: () => {
                        setDeleting(undefined);
                        setRevealed(undefined);
                      },
                    },
                  )
                }
              >
                {t('yes')}
              </Button>
            </div>
          </ModalDialog>
        )}
      </Show>
    </>
  );
}
export default LibraryBookmarks;
