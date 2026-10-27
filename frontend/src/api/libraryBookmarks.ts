import { createMemo, createSignal } from 'solid-js';
import type { BookSearchField } from './books';
import { createCurrentUserSettingsQuery, createMergeCurrentUserSettingsMutation } from './settings';

export type LibraryBookmark = {
  id: string;
  name: string;
  search: string;
  searchField: BookSearchField;
  tags: string[];
};

function isLibraryBookmark(value: unknown): value is LibraryBookmark {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.search === 'string' &&
    (item.searchField === 'title' || item.searchField === 'description') &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === 'string')
  );
}

export function createLibraryBookmarks() {
  const settings = createCurrentUserSettingsQuery();
  const mutation = createMergeCurrentUserSettingsMutation();
  const orderMutation = createMergeCurrentUserSettingsMutation();
  const [pendingOrder, setPendingOrder] = createSignal<LibraryBookmark[]>();
  const bookmarks = createMemo<LibraryBookmark[]>((previous) => {
    const order = pendingOrder();
    if (order) return order;
    const value = settings.data?.libraryBookmarks;
    if (!Array.isArray(value)) return [];
    const previousById = new Map(previous.map((item) => [item.id, item]));
    return value.filter(isLibraryBookmark).map((item) => {
      const existing = previousById.get(item.id);
      // Keep snapshots independent of the query's positional reconciliation and reuse them by ID.
      return existing &&
        existing.name === item.name &&
        existing.search === item.search &&
        existing.searchField === item.searchField &&
        existing.tags.length === item.tags.length &&
        existing.tags.every((tag, index) => tag === item.tags[index])
        ? existing
        : { ...item, tags: [...item.tags] };
    });
  }, []);
  const moveBookmark = (id: string, targetIndex: number) => {
    if (mutation.isPending || orderMutation.isPending) return;
    const ordered = [...bookmarks()];
    const index = ordered.findIndex((item) => item.id === id);
    if (index < 0 || index === targetIndex) return;
    const [item] = ordered.splice(index, 1);
    ordered.splice(targetIndex, 0, item);
    setPendingOrder(ordered);
    orderMutation.mutate(
      { libraryBookmarks: ordered },
      { onSettled: () => setPendingOrder(undefined) },
    );
  };
  return { settings, mutation, orderMutation, bookmarks, moveBookmark };
}
