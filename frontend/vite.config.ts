import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

function normalizeBasePath(value: string | undefined) {
  if (!value || value === "/") {
    return "/";
  }
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [solid()],
  server: {
    proxy: {
      "/api": {
        target: "http://vm:8080",
        changeOrigin: true,
      },
    },
  },
});
