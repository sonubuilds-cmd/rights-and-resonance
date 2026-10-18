import { defineConfig, devices } from '@playwright/test';
// Local-only escape hatch when the pinned Playwright browser build is not installed (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome). CI uses the default.
const executablePath = process.env.PW_CHROMIUM_PATH;
export default defineConfig({
  testDir: './e2e', fullyParallel: false, timeout: 60_000,
  use: {baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure'},
  projects: [{name:'chromium',use:{...devices['Desktop Chrome'],...(executablePath?{launchOptions:{executablePath}}:{})}}],
  // The synthetic spec must be deterministic: never inherit a developer's or CI's real Qloo key. An empty value also wins over .env files.
  webServer: {command:'pnpm --dir ../.. dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,timeout:60_000,env:{QLOO_API_KEY:'',TASTE_SOURCE:'synthetic',GEMINI_API_KEY:'',AGENT_FAKE_MODEL:''}},
});
