import { test as base, expect } from '@playwright/test';
import { createApiMocks } from './support/api';

export const test = base.extend<{ api: ReturnType<typeof createApiMocks> }>({
  api: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const storageKey = 'book-hub-preferences';
        const rawPreferences = localStorage.getItem(storageKey);
        let preferences: Record<string, unknown> = {};

        if (rawPreferences) {
          try {
            const parsed = JSON.parse(rawPreferences);

            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              preferences = parsed as Record<string, unknown>;
            }
          } catch {
            // Tests should start with a valid locale even if stale storage is corrupted.
          }
        }

        localStorage.setItem(storageKey, JSON.stringify({ ...preferences, language: 'ru' }));
      });
      const api = createApiMocks(page);
      await api.mockDefaults();
      await use(api);
      api.assertNoUnexpectedRequests();
    },
    { auto: true },
  ],
});

export { expect };
