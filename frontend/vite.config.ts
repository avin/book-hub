import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath, URL } from 'node:url';

function normalizeBasePath(value: string | undefined) {
  if (!value || value === '/') {
    return '/';
  }
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [solid()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://vm:8080',
        changeOrigin: true,
      },
    },
  },
});
