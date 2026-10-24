import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests-db',
  workers: 1,
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    ...devices['Desktop Chrome'],
    viewport: { width: 1484, height: 992 },
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results/database',
  webServer: {
    command: 'npm run dev -- --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    env: {
      MATTERMOST_ENABLED: 'false',
      VITE_DATA_MODE: 'database',
      ROBOT_BUTLER_DB: `data/test-${Date.now()}.sqlite`,
    },
  },
});
