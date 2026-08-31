import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

function commandOutput(command, args = []) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.trim().split('\n')[0] || null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: 'localhost', port });

    socket.setTimeout(750);
    socket.once('connect', () => {
      socket.destroy();
      resolve('in use (a development server may already be running)');
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve('free');
    });
    socket.once('error', () => resolve('free'));
  });
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const dependenciesInstalled = existsSync(path.join(projectRoot, 'node_modules', 'expo'));
const npmVersion = commandOutput('npm', ['--version']) ?? 'unavailable';
const xcodeVersion = commandOutput('xcodebuild', ['-version']) ?? 'not installed (required for iOS Simulator)';
const adbVersion = commandOutput('adb', ['version']) ?? 'not on PATH (required for Android emulator CLI)';
const metroStatus = await checkPort(8081);

console.log('GlideLingo environment');
console.log(`Project:   ${projectRoot}`);
console.log(`Node:      ${process.version}${nodeMajor >= 22 ? '' : ' (Node 22.13+ required)'}`);
console.log(`npm:       ${npmVersion}`);
console.log(`Expo:      ${packageJson.dependencies.expo}`);
console.log(`Electron:  ${packageJson.devDependencies.electron}`);
console.log(`Packages:  ${dependenciesInstalled ? 'installed' : 'missing — run npm ci'}`);
console.log(`Port 8081: ${metroStatus}`);
console.log(`Xcode:     ${xcodeVersion}`);
console.log(`ADB:       ${adbVersion}`);
console.log('');
console.log('Next checks:');
console.log('  npm run verify        lint, types, and tests');
console.log('  npm run doctor        Expo dependency and configuration checks');
console.log('  npm run start:clear   clear Metro cache for mobile');
console.log('  npm run desktop:clear clear Metro cache for Electron');

if (nodeMajor < 22 || !dependenciesInstalled) {
  process.exitCode = 1;
}
