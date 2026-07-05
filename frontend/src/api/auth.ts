import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { apiClient, getCsrfToken } from "./client";
import { currentUserQueryKey } from "./user";

type Credentials = {
  login: string;
  password: string;
};

export function createLoginMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (credentials: Credentials) => {
      const csrfToken = await getCsrfToken();
      const { data, error } = await apiClient.POST("/v1/auth/login", {
        body: credentials,
        params: {
          header: {
            "X-CSRF-Token": csrfToken,
          },
        },
      });

      if (error || !data) {
        throw error ?? new Error("Login response is empty");
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(currentUserQueryKey, data.user);
    },
  }));
}

export function createRegisterMutation() {
  return createMutation(() => ({
    mutationFn: async (credentials: Credentials) => {
      const csrfToken = await getCsrfToken();
      const { data, error } = await apiClient.POST("/v1/auth/register", {
        body: credentials,
        params: {
          header: {
            "X-CSRF-Token": csrfToken,
          },
        },
      });

      if (error || !data) {
        throw error ?? new Error("Register response is empty");
      }

      return data;
    },
  }));
}
