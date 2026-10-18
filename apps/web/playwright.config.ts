import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, timeout: 60_000,
  use: {baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure'},
  projects: [{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer: {command:'pnpm --dir ../.. dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,timeout:60_000},
});
