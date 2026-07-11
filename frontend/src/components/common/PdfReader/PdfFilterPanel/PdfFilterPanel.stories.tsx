import { I18nProvider } from '@/i18n/I18nProvider';
import {
  defaultPdfFilterChain,
  invertFilterFromChain,
  textEnhancementFilterFromChain,
} from '../pdfFilters';
import PdfFilterPanel from './PdfFilterPanel';

export default {
  component: PdfFilterPanel,
};

export const Default = () => (
  <I18nProvider>
    <PdfFilterPanel
      open
      textEnhancementFilter={textEnhancementFilterFromChain(defaultPdfFilterChain())!}
      invertFilter={invertFilterFromChain(defaultPdfFilterChain())!}
      available
      onClose={() => undefined}
      onToggleTextEnhancement={() => undefined}
      onTextEnhancementParameterChange={() => undefined}
      onToggleInvert={() => undefined}
      onStrengthChange={() => undefined}
      onReset={() => undefined}
    />
  </I18nProvider>
);
