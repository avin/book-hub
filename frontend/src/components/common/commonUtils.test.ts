import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl } from '@/api/baseUrl';
import {
  getBookCoverUrl,
  getBookDownloadName,
  getBookDownloadUrl,
  getBookFileUrl,
} from '@/api/books';
import { clampFixedLayoutPageWidthOverflow } from './FixedLayoutReader/fixedLayoutPageSettings';
import {
  applyWidthRulerPointer,
  clampWidth,
  computeWidthRulerMarkers,
} from './WidthRuler/widthRulerUtils';
import {
  buildLibraryListStateUrl,
  readLibraryListStateFromSearch,
  rememberLibraryListState,
  readInitialLibraryListState,
} from '@/components/pages/LibraryPage/libraryListState';
import { applyTheme, defaultThemeId, isThemeId } from '@/styles/themes';

describe('общие утилиты фронтенда', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('создаёт безопасные API-URL и имя скачиваемого файла', () => {
    vi.stubEnv('VITE_BASE_PATH', '/book-hub/');

    expect(getApiBaseUrl()).toBe('/book-hub/api');
    expect(getBookFileUrl('id/a')).toBe('/book-hub/api/v1/books/id%2Fa/file');
    expect(getBookDownloadUrl('id')).toBe('/book-hub/api/v1/books/id/file?download=1');
    expect(getBookCoverUrl('id', 'thumbnail')).toBe(
      '/book-hub/api/v1/books/id/cover?variant=thumbnail',
    );
    expect(getBookDownloadName({ title: '  a/b:  ', format: 'fb2' })).toBe('ab.fb2');
  });

  it('парсит и записывает состояние списка, не теряя посторонние параметры', () => {
    expect(
      readLibraryListStateFromSearch(
        '?q= sci-fi &tag=fantasy&tag=fantasy&sort=bad&favorite=regular',
      ),
    ).toEqual({
      search: ' sci-fi ',
      searchField: 'title',
      sort: 'relevance',
      favoriteFilter: 'regular',
      tags: ['fantasy'],
    });
    expect(
      buildLibraryListStateUrl(
        {
          search: ' books ',
          searchField: 'title',
          sort: 'title_asc',
          favoriteFilter: 'favorite',
          tags: ['tag', ' tag ', ''],
        },
        { pathname: '/library', search: '?page=2', hash: '#top' },
      ),
    ).toBe('/library?page=2&q=books&sort=title_asc&favorite=favorite&tag=tag#top');

    rememberLibraryListState({
      search: 'remembered',
      searchField: 'title',
      sort: 'relevance',
      favoriteFilter: 'all',
      tags: [],
    });
    window.history.replaceState({}, '', '/library');
    expect(readInitialLibraryListState('').search).toBe('remembered');
    window.history.replaceState({}, '', '/library?q=stale&sort=title_asc');
    expect(readInitialLibraryListState('')).toMatchObject({
      search: 'remembered',
      sort: 'relevance',
    });
    expect(readInitialLibraryListState('?q=current&sort=title_desc')).toMatchObject({
      search: 'current',
      sort: 'title_desc',
    });
  });

  it('ограничивает размеры и обрабатывает указатель линейки ширины', () => {
    const ruler = document.createElement('div');
    Object.defineProperty(ruler, 'getBoundingClientRect', {
      value: () => ({ left: 100, width: 400 }),
    });
    const onWidthChange = vi.fn();
    const onGuideX = vi.fn();

    applyWidthRulerPointer({ clientX: 170 } as PointerEvent, {
      rulerElement: ruler,
      availableWidth: 600,
      minHalfWidth: 140,
      onWidthChange,
      onGuideX,
    });
    expect(onWidthChange).toHaveBeenCalledWith(280);
    expect(onGuideX).toHaveBeenCalledWith(160);
    expect(clampWidth(999, 1, 20)).toBe(20);
    expect(clampFixedLayoutPageWidthOverflow(-10)).toBe(0);
    expect(computeWidthRulerMarkers(ruler, 400, 0).left).toEqual({ left: '0px' });
  });

  it('применяет допустимую тему и учитывает системное оформление', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    expect(defaultThemeId()).toBe('dark-ink');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    expect(defaultThemeId()).toBe('light-sand');
    expect(isThemeId('dark-ocean')).toBe(true);
    expect(isThemeId('unknown')).toBe(false);
    applyTheme('light-sand');
    expect(document.documentElement.dataset.theme).toBe('light-sand');
  });
});
