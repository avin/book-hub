import { Router } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { settingsQueryKey } from '@/api/settings';
import { I18nProvider } from '@/i18n/I18nProvider';
import LibraryBookmarks from './LibraryBookmarks';

export default { component: LibraryBookmarks };
export const Default = () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(settingsQueryKey, {
    libraryBookmarks: [
      {
        id: 'sample',
        name: 'Книги о путешествиях',
        search: 'путешествия',
        searchField: 'description',
        tags: [],
      },
    ],
  });
  return (
    <Router
      root={() => (
        <QueryClientProvider client={client}>
          <I18nProvider>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                width: '248px',
                height: '400px',
              }}
            >
              <LibraryBookmarks />
            </div>
          </I18nProvider>
        </QueryClientProvider>
      )}
    />
  );
};
