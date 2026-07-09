import { createMutation, createQuery } from '@tanstack/solid-query';
import { apiClient, getCsrfToken } from './client';
import type { components } from '@/api/generated/schema';

export type User = components['schemas']['User'];

export const currentUserQueryKey = ['current-user'] as const;

export async function getCurrentUser() {
  const { data, error } = await apiClient.GET('/v1/me');

  if (error || !data) {
    throw error ?? new Error('Current user response is empty');
  }

  return data;
}

export function createCurrentUserQuery() {
  return createQuery(() => ({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUser,
    retry: false,
  }));
}

export async function changeCurrentUserPassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  const csrfToken = await getCsrfToken();
  const { error } = await apiClient.PUT('/v1/me/password', {
    body: {
      current_password: input.currentPassword,
      new_password: input.newPassword,
    },
    params: {
      header: {
        'X-CSRF-Token': csrfToken,
      },
    },
  });

  if (error) {
    throw error;
  }
}

export function createChangePasswordMutation() {
  return createMutation(() => ({
    mutationFn: changeCurrentUserPassword,
  }));
}
