import { test as base, expect } from '@playwright/test';
import { createApiMocks } from './support/api';

export const test = base.extend<{ api: ReturnType<typeof createApiMocks> }>({
  api: [
    async ({ page }, use) => {
      const api = createApiMocks(page);
      await api.mockDefaults();
      await use(api);
      api.assertNoUnexpectedRequests();
    },
    { auto: true },
  ],
});

export { expect };
