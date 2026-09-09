import { _electron as electron, type ElectronApplication } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const repositoryRoot = path.resolve(__dirname, '../..');

export type ElectronRuntime = {
  app: ElectronApplication;
  profileDirectory: string;
};

export async function launchGlideLingoElectron(): Promise<ElectronRuntime> {
  const profileDirectory = await mkdtemp(path.join(tmpdir(), 'glidelingo-operational-e2e-'));
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  delete environment.ELECTRON_RENDERER_URL;
  delete environment.ELECTRON_AUTH_FLOW_TEST;
  delete environment.ELECTRON_SMOKE_TEST;

  try {
    const app = await electron.launch({
      args: ['--user-data-dir=' + profileDirectory, path.join(repositoryRoot, 'desktop')],
      bypassCSP: false,
      chromiumSandbox: true,
      cwd: repositoryRoot,
      env: environment,
      timeout: 45_000,
    });
    return { app, profileDirectory };
  } catch (error) {
    await rm(profileDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function closeGlideLingoElectron(runtime: ElectronRuntime | undefined) {
  if (!runtime) return;
  try {
    await runtime.app.close();
  } finally {
    await rm(runtime.profileDirectory, { force: true, recursive: true });
  }
}
