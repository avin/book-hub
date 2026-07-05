import { createQuery } from "@tanstack/solid-query";
import { apiClient } from "./client";
import type { components } from "@/api/generated/schema";

export type User = components["schemas"]["User"];

export const currentUserQueryKey = ["current-user"] as const;

export async function getCurrentUser() {
  const { data, error } = await apiClient.GET("/v1/me");

  if (error || !data) {
    throw error ?? new Error("Current user response is empty");
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
