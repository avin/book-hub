import createClient from "openapi-fetch";
import type { paths } from "@/api/generated/schema";
import { getApiBaseUrl } from "./baseUrl";

export const apiClient = createClient<paths>({
  baseUrl: getApiBaseUrl(),
  credentials: "include",
});

const csrfCookieName = "book_hub_csrf";

let csrfTokenRequest: Promise<string> | undefined;

function getCookieValue(name: string) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const cookiePrefix = `${name}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix));

  if (!cookie) {
    return undefined;
  }

  const value = cookie.slice(cookiePrefix.length);

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function requestCsrfToken() {
  const { data, error } = await apiClient.GET("/v1/auth/csrf");

  if (error || !data) {
    throw error ?? new Error("CSRF token response is empty");
  }

  return data.csrf_token;
}

export async function getCsrfToken() {
  const csrfToken = getCookieValue(csrfCookieName);

  if (csrfToken) {
    return csrfToken;
  }

  csrfTokenRequest ??= requestCsrfToken().finally(() => {
    csrfTokenRequest = undefined;
  });

  return csrfTokenRequest;
}
