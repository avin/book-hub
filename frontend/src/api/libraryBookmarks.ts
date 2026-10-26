import { createMemo } from 'solid-js';
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
  const bookmarks = createMemo(() => {
    const value = settings.data?.libraryBookmarks;
    return Array.isArray(value) ? value.filter(isLibraryBookmark) : [];
  });
  return { settings, mutation, bookmarks };
}
