import { defineConfig, devices } from '@playwright/test';

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '4322', 10);
const baseURL = `http://127.0.0.1:${port}`;

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    ...viewports.map(({ name, width, height }) => ({
      name: `chromium-${name}`,
      use: { ...devices['Desktop Chrome'], viewport: { width, height } },
    })),
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    env: { PORT: String(port) },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
