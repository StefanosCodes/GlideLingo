import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const electronOnly = args.has('--electron-only');
const stress = args.has('--stress');

if (electronOnly && stress) {
  console.error('Choose either --electron-only or --stress, not both.');
  process.exit(2);
}

const electronPublishableKey = process.env.E2E_ELECTRON_CLERK_PUBLISHABLE_KEY;

if (!electronPublishableKey) {
  console.error(
    'E2E_ELECTRON_CLERK_PUBLISHABLE_KEY is required for the cache-cleared production Electron export.',
  );
  process.exit(2);
}

const { E2E_ELECTRON_CLERK_PUBLISHABLE_KEY: _omittedKey, ...baseEnv } = process.env;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const outputRoot = baseEnv.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results/operational-ui-e2e';
const reportRoot = baseEnv.PLAYWRIGHT_REPORT_DIR ?? 'playwright-report/operational-ui-e2e';

function projectEnvironment(project, additions = {}) {
  return {
    ...baseEnv,
    ...additions,
    PLAYWRIGHT_OUTPUT_DIR: path.join(outputRoot, project),
    PLAYWRIGHT_REPORT_DIR: path.join(reportRoot, project),
  };
}

function run(commandArgs, env = baseEnv) {
  const result = spawnSync(npmCommand, commandArgs, {
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!electronOnly) {
  const webProject = stress ? 'stress-web' : 'expo-web';
  run([
    'exec',
    '--',
    'playwright',
    'test',
    `--project=${webProject}`,
  ], projectEnvironment(webProject));
}

run(['run', 'desktop:export', '--', '--clear'], {
  ...baseEnv,
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: electronPublishableKey,
});

run(
  [
    'exec',
    '--',
    'playwright',
    'test',
    `--project=${stress ? 'stress-electron' : 'electron'}`,
  ],
  projectEnvironment(stress ? 'stress-electron' : 'electron', {
    E2E_SKIP_WEB_SERVER: '1',
  }),
);
