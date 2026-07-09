import { I18nProvider } from '@/i18n/I18nProvider';
import LanguageSelect from './LanguageSelect';

export default { component: LanguageSelect };

export const Default = () => (
  <I18nProvider>
    <LanguageSelect />
  </I18nProvider>
);
