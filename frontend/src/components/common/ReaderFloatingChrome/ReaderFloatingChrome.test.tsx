import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  getMinimalScrollbarsPreference,
  setLanguagePreference,
} from '@/storage/browserPreferences';
import ReaderFloatingChrome from './ReaderFloatingChrome';
import styles from './ReaderFloatingChrome.module.scss';

beforeEach(() => {
  localStorage.clear();
  setLanguagePreference('ru');
});
afterEach(cleanup);

describe('тонкие полосы прокрутки читалки', () => {
  const renderChrome = () =>
    render(() => (
      <I18nProvider>
        <ReaderFloatingChrome visible onShow={() => undefined} bottomContent={<span>42%</span>} />
      </I18nProvider>
    ));

  it('переключает режим, сохраняет его при повторном открытии и убирает стили вне читалки', () => {
    const first = renderChrome();
    const button = first.getByRole('button', { name: 'Тонкие полосы прокрутки' });
    const root = document.documentElement;

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toBe('');
    expect(root.classList.contains(styles.minimalScrollbars)).toBe(false);

    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(root.classList.contains(styles.minimalScrollbars)).toBe(true);
    expect(getMinimalScrollbarsPreference()).toBe(true);

    first.unmount();
    expect(root.classList.contains(styles.minimalScrollbars)).toBe(false);
    expect(root.style.getPropertyValue('--reader-scrollbar-background')).toBe('');

    const second = renderChrome();
    const restoredButton = second.getByRole('button', { name: 'Тонкие полосы прокрутки' });
    expect(restoredButton.getAttribute('aria-pressed')).toBe('true');
    expect(root.classList.contains(styles.minimalScrollbars)).toBe(true);

    fireEvent.click(restoredButton);
    expect(root.classList.contains(styles.minimalScrollbars)).toBe(false);
    expect(getMinimalScrollbarsPreference()).toBe(false);
  });

  it('обновляет фон полос при смене фона книги', () => {
    const [background, setBackground] = createSignal('#f7f3ea');
    render(() => (
      <I18nProvider>
        <ReaderFloatingChrome visible onShow={() => undefined} scrollbarBackground={background()} />
      </I18nProvider>
    ));

    expect(document.documentElement.style.getPropertyValue('--reader-scrollbar-background')).toBe(
      '#f7f3ea',
    );
    setBackground('#111111');
    expect(document.documentElement.style.getPropertyValue('--reader-scrollbar-background')).toBe(
      '#111111',
    );
  });
});
