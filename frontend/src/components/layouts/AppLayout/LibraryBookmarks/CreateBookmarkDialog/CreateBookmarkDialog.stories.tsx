import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { I18nProvider } from '@/i18n/I18nProvider';
import CreateBookmarkDialog from './CreateBookmarkDialog';

export default { component: CreateBookmarkDialog };
export const Default = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>
      <CreateBookmarkDialog
        saving={false}
        error={false}
        onSave={() => undefined}
        onClose={() => undefined}
      />
    </I18nProvider>
  </QueryClientProvider>
);
