import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const skipWebServer = process.env.E2E_SKIP_WEB_SERVER === '1';
const outputDirectory = process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results/operational-ui-e2e';
const reportDirectory = process.env.PLAYWRIGHT_REPORT_DIR ?? 'playwright-report/operational-ui-e2e';

export default defineConfig({
  testDir: './e2e',
  outputDir: outputDirectory,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: reportDirectory }],
    ['json', { outputFile: reportDirectory + '/results.json' }],
  ],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: 'npm run e2e:web:server',
        url: 'http://localhost:8093',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [
    {
      name: 'expo-web',
      testMatch: 'expo-web.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:8093',
      },
    },
    {
      name: 'electron',
      testMatch: 'electron.spec.ts',
      workers: 1,
    },
    {
      name: 'stress-web',
      testMatch: ['stress/web-observability.spec.ts', 'stress/controlled-failure.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:8093',
      },
    },
    {
      name: 'stress-electron',
      testMatch: 'stress/electron-observability.spec.ts',
      workers: 1,
    },
  ],
});
