import type { BookSort } from "@/api/books";

export type LibraryFavoriteFilter = "all" | "favorite" | "regular";

export type LibraryListState = {
  search: string;
  sort: BookSort;
  favoriteFilter: LibraryFavoriteFilter;
  tags: string[];
};

const defaultLibraryListState: LibraryListState = {
  search: "",
  sort: "relevance",
  favoriteFilter: "all",
  tags: [],
};

const listQueryParamNames = ["q", "tag", "sort", "favorite"] as const;
const sortValues = new Set<BookSort>([
  "relevance",
  "created_at_desc",
  "title_asc",
  "title_desc",
]);
const favoriteFilterValues = new Set<LibraryFavoriteFilter>(["all", "favorite", "regular"]);

let lastLibraryListState: LibraryListState = cloneLibraryListState(defaultLibraryListState);

function cloneLibraryListState(state: LibraryListState): LibraryListState {
  return {
    search: state.search,
    sort: state.sort,
    favoriteFilter: state.favoriteFilter,
    tags: [...state.tags],
  };
}

function uniqueNonEmptyValues(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function hasLibraryListParams(params: URLSearchParams) {
  return listQueryParamNames.some((paramName) => params.has(paramName));
}

function parseBookSort(value: string | null): BookSort {
  if (value && sortValues.has(value as BookSort)) {
    return value as BookSort;
  }

  return defaultLibraryListState.sort;
}

function parseFavoriteFilter(value: string | null): LibraryFavoriteFilter {
  if (value && favoriteFilterValues.has(value as LibraryFavoriteFilter)) {
    return value as LibraryFavoriteFilter;
  }

  return defaultLibraryListState.favoriteFilter;
}

export function getDefaultLibraryListState() {
  return cloneLibraryListState(defaultLibraryListState);
}

export function readLibraryListStateFromSearch(search: string) {
  const params = new URLSearchParams(search);

  if (!hasLibraryListParams(params)) {
    return undefined;
  }

  return {
    search: params.get("q") ?? defaultLibraryListState.search,
    sort: parseBookSort(params.get("sort")),
    favoriteFilter: parseFavoriteFilter(params.get("favorite")),
    tags: uniqueNonEmptyValues(params.getAll("tag")),
  } satisfies LibraryListState;
}

export function readInitialLibraryListState() {
  return readLibraryListStateFromSearch(window.location.search) ?? cloneLibraryListState(lastLibraryListState);
}

export function rememberLibraryListState(state: LibraryListState) {
  lastLibraryListState = cloneLibraryListState(state);
}

export function buildLibraryListStateUrl(
  state: LibraryListState,
  location: Pick<Location, "pathname" | "search" | "hash"> = window.location,
) {
  const params = new URLSearchParams(location.search);

  for (const paramName of listQueryParamNames) {
    params.delete(paramName);
  }

  const search = state.search.trim();

  if (search) {
    params.set("q", search);
  }
  if (state.sort !== defaultLibraryListState.sort) {
    params.set("sort", state.sort);
  }
  if (state.favoriteFilter !== defaultLibraryListState.favoriteFilter) {
    params.set("favorite", state.favoriteFilter);
  }
  for (const tag of uniqueNonEmptyValues(state.tags)) {
    params.append("tag", tag);
  }

  const nextSearch = params.toString();
  return `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`;
}
