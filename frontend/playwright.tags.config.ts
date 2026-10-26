import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: /tags-(keyboard|select)\.spec\.ts/,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
