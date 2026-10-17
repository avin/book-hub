import { QueryCache, QueryClient } from '@tanstack/solid-query';
import { currentUserQueryKey } from './user';

function apiErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' ? code : undefined;
}

export function createAppQueryClient() {
  const handleError = (error: unknown) => {
    if (apiErrorCode(error) !== 'unauthorized') {
      return;
    }

    // Only read queries get here: mutations also report wrong passwords as
    // `unauthorized`, which must not end the session.
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== currentUserQueryKey[0],
    });
    queryClient.setQueryData(currentUserQueryKey, null);
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] !== currentUserQueryKey[0]) {
          handleError(error);
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => apiErrorCode(error) === undefined && failureCount < 2,
      },
    },
  });

  return queryClient;
}
