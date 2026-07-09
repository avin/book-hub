export const settings = {};

export const req = {
  settings: { method: "GET", path: "/v1/me/settings" },
  updateSettings: { method: "PUT", path: "/v1/me/settings" },
  password: { method: "PUT", path: "/v1/me/password" },
  resetProgress: { method: "DELETE", path: "/v1/me/progress" },
} as const;
