import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import { themeIds } from './themes';

const runStartupScript = new Function(
  'localStorage',
  'document',
  'window',
  indexHtml.match(/<script>([\s\S]*?)<\/script>/)![1],
);

function applyStartupTheme(
  storage: { getItem: () => string | null },
  root: HTMLElement,
  dark = false,
) {
  runStartupScript(storage, { documentElement: root }, { matchMedia: () => ({ matches: dark }) });
}

describe.each([false, true])('тема до первого рендера (тёмное оформление: %s)', (dark) => {
  it.each([null, '{}', '{', 'null', JSON.stringify({ theme: 'unknown' })])(
    'выбирает системный дефолт при отсутствующих или повреждённых настройках: %s',
    (stored) => {
      const root = document.createElement('html');
      applyStartupTheme({ getItem: () => stored }, root, dark);
      expect(root.dataset.theme).toBe(dark ? 'dark-ink' : 'light-sand');
    },
  );

  it.each(themeIds)('сохраняет выбор допустимой темы %s', (theme) => {
    const root = document.createElement('html');
    applyStartupTheme({ getItem: () => JSON.stringify({ theme }) }, root, dark);
    expect(root.dataset.theme).toBe(theme);
  });

  it('выбирает системный дефолт при недоступном хранилище', () => {
    const root = document.createElement('html');
    applyStartupTheme(
      {
        getItem: () => {
          throw new Error('Storage unavailable');
        },
      },
      root,
      dark,
    );
    expect(root.dataset.theme).toBe(dark ? 'dark-ink' : 'light-sand');
  });
});
