import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const outputDirectory = process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results/authenticated-e2e';
const reportDirectory = process.env.PLAYWRIGHT_REPORT_DIR ?? 'playwright-report/authenticated-e2e';
const clientEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) =>
      typeof value === 'string' &&
      name !== 'CLERK_SECRET_KEY' &&
      name !== 'CLERK_TESTING_TOKEN',
  ),
) as Record<string, string>;

export default defineConfig({
  testDir: './e2e/authenticated',
  outputDir: outputDirectory,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  globalSetup: './e2e/support/clerk-global-setup.ts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: reportDirectory }],
    ['json', { outputFile: reportDirectory + '/results.json' }],
  ],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'npm run e2e:auth:api',
      env: clientEnvironment,
      url: 'http://localhost:8123/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run e2e:auth:web:server',
      env: clientEnvironment,
      url: 'http://localhost:8081',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'authenticated-web',
      testMatch: 'expo-web.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:8081',
      },
    },
    {
      name: 'authenticated-electron',
      testMatch: 'electron.spec.ts',
    },
  ],
});
