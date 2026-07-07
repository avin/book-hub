import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { components } from "@/api/generated/schema";
import { apiClient, getCsrfToken } from "./client";

export type Settings = components["schemas"]["Settings"];

export const settingsQueryKey = ["settings"] as const;

export async function getCurrentUserSettings() {
  const { data, error } = await apiClient.GET("/v1/me/settings");

  if (error || !data) {
    throw error ?? new Error("Settings response is empty");
  }

  return data;
}

export function createCurrentUserSettingsQuery(enabled: () => boolean = () => true) {
  return createQuery(() => ({
    queryKey: settingsQueryKey,
    queryFn: getCurrentUserSettings,
    retry: false,
    enabled: enabled(),
  }));
}

export async function updateCurrentUserSettings(settings: Settings) {
  const csrfToken = await getCsrfToken();
  const { data, error } = await apiClient.PUT("/v1/me/settings", {
    body: settings,
    params: {
      header: {
        "X-CSRF-Token": csrfToken,
      },
    },
  });

  if (error || !data) {
    throw error ?? new Error("Settings update response is empty");
  }

  return data;
}

export function createUpdateCurrentUserSettingsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: updateCurrentUserSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKey, settings);
    },
  }));
}

export function createMergeCurrentUserSettingsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (settingsPatch: Settings) => {
      const settings = queryClient.getQueryData<Settings>(settingsQueryKey) ?? (await getCurrentUserSettings());

      return updateCurrentUserSettings({
        ...settings,
        ...settingsPatch,
      });
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKey, settings);
    },
  }));
}
