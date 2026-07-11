import { I18nProvider } from '@/i18n/I18nProvider';
import { defaultPdfFilterChain } from '../pdfFilters';
import PdfFilterPanel from './PdfFilterPanel';

export default {
  component: PdfFilterPanel,
};

export const Default = () => (
  <I18nProvider>
    <PdfFilterPanel
      open
      filter={defaultPdfFilterChain()[0]}
      available
      onClose={() => undefined}
      onToggleInvert={() => undefined}
      onStrengthChange={() => undefined}
      onReset={() => undefined}
    />
  </I18nProvider>
);
