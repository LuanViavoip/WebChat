import { defineConfig, devices } from '@playwright/test';

const port = 4177;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${String(port)}`,
    url: `http://127.0.0.1:${String(port)}`,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
