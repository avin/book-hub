import createClient from "openapi-fetch";
import type { paths } from "@/api/generated/schema";
import { getApiBaseUrl } from "./baseUrl";

export const apiClient = createClient<paths>({
  baseUrl: getApiBaseUrl(),
  credentials: "include",
});

export async function getCsrfToken() {
  const { data, error } = await apiClient.GET("/v1/auth/csrf");

  if (error || !data) {
    throw error ?? new Error("CSRF token response is empty");
  }

  return data.csrf_token;
}
