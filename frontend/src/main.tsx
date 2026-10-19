import './polyfills/esnext';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { clearModuleReloadParameter } from './loadModule';
import { createAppQueryClient } from './api/queryClient';
import App from './components/App/App';
import PageLockerProvider from './components/common/PageLockerProvider/PageLockerProvider';
import { I18nProvider } from './i18n/I18nProvider';
import ProfileLanguageSync from './i18n/ProfileLanguageSync';
import ThemeSync from './styles/ThemeSync';
import './styles/app.scss';

clearModuleReloadParameter();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

const queryClient = createAppQueryClient();

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <PageLockerProvider>
          <ProfileLanguageSync />
          <ThemeSync />
          <App />
        </PageLockerProvider>
      </I18nProvider>
    </QueryClientProvider>
  ),
  root,
);
