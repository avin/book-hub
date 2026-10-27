import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { I18nProvider } from '@/i18n/I18nProvider';
import BookmarkDialog from './BookmarkDialog';

export default { component: BookmarkDialog };
export const Default = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>
      <BookmarkDialog
        saving={false}
        error={false}
        onSave={() => undefined}
        onClose={() => undefined}
      />
    </I18nProvider>
  </QueryClientProvider>
);

export const Edit = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>
      <BookmarkDialog
        bookmark={{
          id: 'example',
          name: 'Романы',
          search: 'море',
          searchField: 'description',
          tags: ['роман'],
        }}
        saving={false}
        error={false}
        onSave={() => undefined}
        onClose={() => undefined}
        onDelete={() => undefined}
      />
    </I18nProvider>
  </QueryClientProvider>
);
