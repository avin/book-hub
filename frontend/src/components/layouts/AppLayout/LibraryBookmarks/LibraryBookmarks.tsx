import { Portal } from 'solid-js/web';
import { useLocation, useNavigate } from '@solidjs/router';
import { Bookmark, Pencil, Plus } from 'lucide-solid';
import { batch, createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createLibraryBookmarks, type LibraryBookmark } from '@/api/libraryBookmarks';
import Button from '@/components/common/Button/Button';
import ModalDialog from '@/components/common/ModalDialog/ModalDialog';
import {
  buildLibraryListStateUrl,
  currentLibraryListState,
  libraryBookmarkApplication,
  getLastLibraryListState,
  rememberLibraryListState,
  setLibraryBookmarkApplication,
} from '@/components/pages/LibraryPage/libraryListState';
import {
  getActiveLibraryBookmarkPreference,
  setActiveLibraryBookmarkPreference,
} from '@/storage/browserPreferences';
import { useI18n } from '@/i18n/I18nProvider';
import BookmarkDialog from './BookmarkDialog/BookmarkDialog';
import BookmarkList from './BookmarkList/BookmarkList';
import styles from './LibraryBookmarks.module.scss';

function LibraryBookmarks() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const isReadingBook = () => /^\/reader\/[^/]+\/?$/.test(location.pathname);
  const [activeId, setActiveId] = createSignal(getActiveLibraryBookmarkPreference());
  const selectBookmark = (id: string | undefined) => {
    setActiveId(id);
    setActiveLibraryBookmarkPreference(id);
  };
  const { settings, mutation, orderMutation, bookmarks, moveBookmark } = createLibraryBookmarks();
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [editing, setEditing] = createSignal<LibraryBookmark>();
  const [deleting, setDeleting] = createSignal<LibraryBookmark>();
  const [revealed, setRevealed] = createSignal<string>();
  createEffect(() => {
    const id = activeId();
    if (!id || libraryBookmarkApplication()) return;
    if (location.pathname.replace(/\/+$/, '') !== '/library' && !isReadingBook()) {
      selectBookmark(undefined);
      return;
    }
    if (!settings.isSuccess) return;
    const bookmark = bookmarks().find((item) => item.id === id);
    const state = currentLibraryListState();
    if (
      !bookmark ||
      (state &&
        (state.search.trim() !== bookmark.search.trim() ||
          state.searchField !== bookmark.searchField))
    )
      selectBookmark(undefined);
  });
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
  const closeEditing = () => {
    setEditing(undefined);
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
    batch(() => {
      rememberLibraryListState(state);
      setLibraryBookmarkApplication(state);
      selectBookmark(bookmark.id);
      setMobileOpen(false);
      navigate(buildLibraryListStateUrl(state, { pathname: '/library', search: '', hash: '' }));
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const list = () => (
    <>
      <BookmarkList disabled={mutation.isPending} onMove={moveBookmark}>
        <For each={bookmarks()}>
          {(bookmark) => (
            <div
              class={styles.row}
              data-bookmark-id={bookmark.id}
              classList={{
                [styles.revealed]: revealed() === bookmark.id,
                [styles.active]: activeId() === bookmark.id,
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                class={styles.handle}
                data-bookmark-drag-handle
                aria-label={`${t('moveBookmark')} ${bookmark.name}`}
                title={`${t('moveBookmark')} ${bookmark.name}`}
                disabled={mutation.isPending}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  const index = bookmarks().findIndex((item) => item.id === bookmark.id);
                  const target = index + (event.key === 'ArrowUp' ? -1 : 1);
                  if (target >= 0 && target < bookmarks().length) moveBookmark(bookmark.id, target);
                }}
              >
                <Bookmark aria-hidden="true" />
              </button>
              <button
                type="button"
                class={styles.link}
                title={bookmark.name}
                aria-pressed={activeId() === bookmark.id}
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
                class={styles.edit}
                data-bookmark-edit
                aria-label={`${t('editBookmark')} ${bookmark.name}`}
                onClick={() => {
                  mutation.reset();
                  setEditing(bookmark);
                }}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </For>
      </BookmarkList>
      <Show
        when={
          (mutation.isError || orderMutation.isError) && !creating() && !editing() && !deleting()
        }
      >
        <p role="alert">{t('requestFailedTryAgain')}</p>
      </Show>
      <Show when={settings.isError}>
        <p role="alert">{t('requestFailedTryAgain')}</p>
        <Button variant="ghost" onClick={() => void settings.refetch()}>
          {t('retry')}
        </Button>
      </Show>
      <button
        class={styles.create}
        type="button"
        disabled={!settings.isSuccess || mutation.isPending}
        onClick={openCreation}
      >
        <Plus aria-hidden="true" />
        <span>{t('createBookmark')}</span>
      </button>
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
      <Portal>
        <Show when={mobileOpen() && !creating() && !editing() && !deleting()}>
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
          <BookmarkDialog
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
        <Show when={editing()}>
          {(bookmark) => (
            <BookmarkDialog
              bookmark={bookmark()}
              hidden={!!deleting()}
              saving={mutation.isPending}
              error={mutation.isError}
              onClose={closeEditing}
              onDelete={() => {
                mutation.reset();
                setDeleting(bookmark());
              }}
              onSave={(updated) =>
                mutation.mutate(
                  {
                    libraryBookmarks: bookmarks().map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  },
                  { onSuccess: closeEditing },
                )
              }
            />
          )}
        </Show>
        <Show when={deleting()}>
          {(bookmark) => (
            <ModalDialog
              ariaLabel={t('deleteBookmark')}
              overlayClass={styles.overlay}
              contentClass={styles.dialog}
              onClose={() => {
                if (!mutation.isPending) {
                  setDeleting(undefined);
                  mutation.reset();
                }
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
                  onClick={() => {
                    setDeleting(undefined);
                    mutation.reset();
                  }}
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
                          setEditing(undefined);
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
      </Portal>
    </>
  );
}
export default LibraryBookmarks;
