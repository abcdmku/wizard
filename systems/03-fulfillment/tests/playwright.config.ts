import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: process.env.FULFILLMENT_WEB_URL ?? 'http://localhost:4500',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
})
