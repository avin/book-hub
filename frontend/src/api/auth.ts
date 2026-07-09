import { createMutation, type QueryClient, useQueryClient } from '@tanstack/solid-query';
import { booksQueryKey } from './books';
import { apiClient, getCsrfToken } from './client';
import { settingsQueryKey } from './settings';
import { currentUserQueryKey } from './user';

type Credentials = {
  login: string;
  password: string;
};

function removePrivateQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: booksQueryKey });
  queryClient.removeQueries({ queryKey: ['book'] });
  queryClient.removeQueries({ queryKey: ['book-file-text'] });
  queryClient.removeQueries({ queryKey: ['book-progress'] });
  queryClient.removeQueries({ queryKey: settingsQueryKey });
}

export function createLoginMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (credentials: Credentials) => {
      const csrfToken = await getCsrfToken();
      const { data, error } = await apiClient.POST('/v1/auth/login', {
        body: credentials,
        params: {
          header: {
            'X-CSRF-Token': csrfToken,
          },
        },
      });

      if (error || !data) {
        throw error ?? new Error('Login response is empty');
      }

      return data;
    },
    onSuccess: (data) => {
      removePrivateQueries(queryClient);
      queryClient.setQueryData(currentUserQueryKey, data.user);
    },
  }));
}

export function createRegisterMutation() {
  return createMutation(() => ({
    mutationFn: async (credentials: Credentials) => {
      const csrfToken = await getCsrfToken();
      const { data, error } = await apiClient.POST('/v1/auth/register', {
        body: credentials,
        params: {
          header: {
            'X-CSRF-Token': csrfToken,
          },
        },
      });

      if (error || !data) {
        throw error ?? new Error('Register response is empty');
      }

      return data;
    },
  }));
}

export function createLogoutMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async () => {
      const csrfToken = await getCsrfToken();
      const { error } = await apiClient.POST('/v1/auth/logout', {
        params: {
          header: {
            'X-CSRF-Token': csrfToken,
          },
        },
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      removePrivateQueries(queryClient);
      queryClient.setQueryData(currentUserQueryKey, null);
    },
  }));
}
