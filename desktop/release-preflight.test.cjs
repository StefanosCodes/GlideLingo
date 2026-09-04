const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertReleaseTagAvailable,
  resetReleaseDirectory,
  runReleasePreflight,
  validateVersionContracts,
  verifyUnsignedBundle,
} = require('./release-preflight.cjs');

function versionContracts(version = '1.0.7') {
  return {
    lockManifest: { version, packages: { '': { version } } },
    packageManifest: { version },
  };
}

test('desktop package and lockfile versions must be one strict matching release', () => {
  const { lockManifest, packageManifest } = versionContracts();
  assert.equal(validateVersionContracts(packageManifest, lockManifest), '1.0.7');
  assert.throws(
    () => validateVersionContracts(packageManifest, { ...lockManifest, version: '1.0.6' }),
    /must match/,
  );
  assert.throws(
    () => validateVersionContracts({ version: '1.0.7-beta.1' }, lockManifest),
    /strict numeric SemVer/,
  );
});

test('release preflight requires an unused local and remote tag', () => {
  const responses = [
    { status: 1, stdout: '', stderr: '' },
    { status: 2, stdout: '', stderr: '' },
  ];
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    return responses.shift();
  };
  assert.equal(assertReleaseTagAvailable('1.0.7', runner), 'desktop-v1.0.7');
  assert.deepEqual(calls[1], [
    'git',
    ['ls-remote', '--exit-code', '--tags', 'origin', 'refs/tags/desktop-v1.0.7'],
  ]);

  assert.throws(
    () => assertReleaseTagAvailable('1.0.7', () => ({ status: 0 })),
    /already exists locally/,
  );
  assert.throws(
    () => assertReleaseTagAvailable('1.0.7', (() => {
      const results = [{ status: 1 }, { status: 128, stderr: 'token=private' }];
      return () => results.shift();
    })()),
    /could not be verified/,
  );
});

test('release preflight cleans only a real release-dry-run directory', (context) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-preflight-'));
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const releaseDirectory = path.join(projectRoot, 'release-dry-run');
  fs.mkdirSync(releaseDirectory);
  fs.writeFileSync(path.join(releaseDirectory, 'stale'), 'old');

  resetReleaseDirectory(releaseDirectory, { projectRoot });
  assert.deepEqual(fs.readdirSync(releaseDirectory), []);
  assert.throws(
    () => resetReleaseDirectory(path.join(projectRoot, 'release'), { projectRoot }),
    /only the project release-dry-run/,
  );

  fs.rmSync(releaseDirectory, { recursive: true });
  fs.symlinkSync(projectRoot, releaseDirectory);
  assert.throws(
    () => resetReleaseDirectory(releaseDirectory, { projectRoot }),
    /must not be a symbolic link/,
  );
});

test('unsigned bundle verification requires matching version and universal architecture', () => {
  const outputs = ['1.0.7\n', 'x86_64 arm64\n'];
  assert.deepEqual(
    verifyUnsignedBundle('/tmp/release-dry-run', '1.0.7', () => ({
      status: 0,
      stdout: outputs.shift(),
    })),
    { architectures: ['x86_64', 'arm64'], builtVersion: '1.0.7' },
  );
  assert.throws(
    () => verifyUnsignedBundle('/tmp/release-dry-run', '1.0.7', (() => {
      const wrongArchitecture = ['1.0.7\n', 'arm64\n'];
      return () => ({ status: 0, stdout: wrongArchitecture.shift() });
    })()),
    /both x86_64 and arm64/,
  );
});

test('release preflight runs the complete local gate before validating unsigned artifacts', (context) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-preflight-'));
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const commands = [];
  const logs = [];
  const runner = (command, args) => {
    commands.push([command, args]);
    if (command === 'git' && args[0] === 'show-ref') return { status: 1, stdout: '' };
    if (command === 'git' && args[0] === 'ls-remote') return { status: 2, stdout: '' };
    return { status: 0, stdout: '' };
  };
  const assets = Array.from({ length: 6 }, (_, index) => ({ name: `asset-${index}` }));

  const result = runReleasePreflight({
    ...versionContracts(),
    commandRunner: runner,
    inspectAssets: () => assets,
    logger: { log: (message) => logs.push(message) },
    platform: 'darwin',
    projectRoot,
    verifyBundle: () => ({ architectures: ['x86_64', 'arm64'], builtVersion: '1.0.7' }),
    writeAssetChecksums: () => {},
  });

  assert.equal(result.releaseTag, 'desktop-v1.0.7');
  assert.deepEqual(commands.slice(2, 5), [
    ['npm', ['run', 'env:check']],
    ['npm', ['ci', '--prefix', 'desktop', '--ignore-scripts']],
    ['npm', ['run', 'verify:full-stack']],
  ]);
  assert.ok(commands.at(-1)[1].includes('electron-builder'));
  assert.ok(logs.some((message) => message.includes('non-distributable')));
});

test('release preflight is macOS-only', () => {
  assert.throws(
    () => runReleasePreflight({ platform: 'linux' }),
    /must run on macOS/,
  );
});
