import { defineConfig, devices } from '@playwright/test';

const port = 4177;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:${String(port)}/chat/`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm run dev --host 127.0.0.1 --port ${String(port)}`,
    url: `http://127.0.0.1:${String(port)}/chat/`,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: '1366',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
    {
      name: '1920',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: '2560',
      use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 } },
    },
    {
      name: '390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});
