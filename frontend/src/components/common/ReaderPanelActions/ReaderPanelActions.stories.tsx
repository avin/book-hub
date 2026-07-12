import { I18nProvider } from '@/i18n/I18nProvider';
import ReaderPanelActions from './ReaderPanelActions';

export default {
  component: ReaderPanelActions,
};

export const Default = () => (
  <I18nProvider>
    <ReaderPanelActions onReset={() => undefined} onAutoWidth={() => undefined} />
  </I18nProvider>
);
