function normalizeBasePath(value: string | undefined) {
  if (!value || value === "/") {
    return "";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export function getApiBaseUrl() {
  return `${normalizeBasePath(import.meta.env.VITE_BASE_PATH)}/api`;
}
