import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryBookmark } from '@/api/libraryBookmarks';
import {
  getDefaultLibraryListState,
  rememberLibraryListState,
} from '@/components/pages/LibraryPage/libraryListState';
import { I18nProvider } from '@/i18n/I18nProvider';
import { setLanguagePreference } from '@/storage/browserPreferences';
import BookmarkDialog from './BookmarkDialog';

vi.mock('@/api/books', () => ({
  createBookTagsQuery: () => ({ data: { items: [] } }),
}));

function renderDialog(bookmark?: LibraryBookmark) {
  return render(() => (
    <I18nProvider>
      <BookmarkDialog
        bookmark={bookmark}
        saving={false}
        error={false}
        onSave={() => undefined}
        onClose={() => undefined}
      />
    </I18nProvider>
  ));
}

beforeEach(() => {
  setLanguagePreference('ru');
  rememberLibraryListState(getDefaultLibraryListState());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  rememberLibraryListState(getDefaultLibraryListState());
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('название новой закладки', () => {
  it.each([
    { search: '555', tags: ['foo', 'bar'], expected: '555 foo bar' },
    { search: ' 555 ', tags: [], expected: '555' },
    { search: '', tags: ['foo', 'bar'], expected: 'foo bar' },
    { search: '  ', tags: [], expected: 'Закладка' },
    { search: 'a'.repeat(101), tags: ['foo'], expected: 'a'.repeat(100) },
  ])('предзаполняет название из $search и $tags', ({ search, tags, expected }) => {
    rememberLibraryListState({ ...getDefaultLibraryListState(), search, tags });
    const view = renderDialog();
    const name = view.getByRole('textbox', { name: 'Название' }) as HTMLInputElement;
    expect(name.value).toBe(expected);
    expect(document.activeElement).toBe(name);
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(expected.length);
  });

  it('не выделяет название повторно при возвращении фокуса в поле', () => {
    const view = renderDialog();
    const name = view.getByRole('textbox', { name: 'Название' }) as HTMLInputElement;
    name.setSelectionRange(2, 2);
    name.blur();
    name.focus();
    expect(name.selectionStart).toBe(2);
    expect(name.selectionEnd).toBe(2);
  });

  it('сохраняет введённое название при изменении поиска в открытой форме', () => {
    rememberLibraryListState({ ...getDefaultLibraryListState(), search: '555' });
    const view = renderDialog();
    const name = view.getByRole('textbox', { name: 'Название' }) as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Моя закладка' } });
    fireEvent.input(view.getByRole('textbox', { name: 'Поиск книг' }), {
      target: { value: '666' },
    });
    expect(name.value).toBe('Моя закладка');
  });

  it('сохраняет существующее название при редактировании', () => {
    const view = renderDialog({
      id: 'existing',
      name: 'Моя закладка',
      search: '555',
      searchField: 'description',
      tags: ['foo', 'bar'],
    });
    expect((view.getByRole('textbox', { name: 'Название' }) as HTMLInputElement).value).toBe(
      'Моя закладка',
    );
  });
});
