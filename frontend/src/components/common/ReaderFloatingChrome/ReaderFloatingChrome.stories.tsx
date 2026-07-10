import { createSignal } from 'solid-js';
import { I18nProvider } from '@/i18n/I18nProvider';
import ReaderFloatingChrome from './ReaderFloatingChrome';

export default { component: ReaderFloatingChrome };

export function Default() {
  const [visible, setVisible] = createSignal(true);
  const [searchValue, setSearchValue] = createSignal('');

  return (
    <I18nProvider>
      <div style={{ height: '320px', background: 'var(--surface-page)' }}>
        <ReaderFloatingChrome
          visible={visible()}
          searchValue={searchValue()}
          bottomContent={<span>42%</span>}
          onSearchValueChange={setSearchValue}
          onSearchNext={() => undefined}
          onSearchPrevious={() => undefined}
          onClose={() => setVisible(false)}
          onShow={() => setVisible(true)}
        />
      </div>
    </I18nProvider>
  );
}
