const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { inspectLocalAssets, writeChecksums } = require('./release-workflow.cjs');
const { validateReleaseTag } = require('./release.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RELEASE_DIRECTORY_NAME = 'release-dry-run';
const MAC_EXECUTABLE_RELATIVE_PATH = 'mac-universal/GlideLingo.app/Contents/MacOS/GlideLingo';
const MAC_INFO_PLIST_RELATIVE_PATH = 'mac-universal/GlideLingo.app/Contents/Info.plist';

function run(command, args, { allowFailure = false, capture = false, cwd = PROJECT_ROOT, label } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });

  const safeLabel = label || command;
  if (result.error) {
    throw new Error(`${safeLabel} could not start.`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${safeLabel} failed.`);
  }
  return result;
}

function validateVersionContracts(packageManifest, lockManifest) {
  const desktopVersion = packageManifest?.version;
  validateReleaseTag(undefined, desktopVersion);

  if (
    lockManifest?.version !== desktopVersion ||
    lockManifest?.packages?.['']?.version !== desktopVersion
  ) {
    throw new Error(
      'desktop/package.json and both desktop/package-lock.json version fields must match.',
    );
  }

  return desktopVersion;
}

function assertReleaseTagAvailable(desktopVersion, commandRunner = run) {
  const releaseTag = `desktop-v${desktopVersion}`;
  const local = commandRunner(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/tags/${releaseTag}`],
    { allowFailure: true, capture: true, label: 'Local release-tag check' },
  );
  if (local.status === 0) {
    throw new Error(`${releaseTag} already exists locally; desktop versions are immutable.`);
  }
  if (local.status !== 1) {
    throw new Error(`Local release-tag availability for ${releaseTag} could not be verified.`);
  }

  const remote = commandRunner(
    'git',
    ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${releaseTag}`],
    { allowFailure: true, capture: true, label: 'Remote release-tag check' },
  );
  if (remote.status === 0) {
    throw new Error(`${releaseTag} already exists on origin; choose a new desktop version.`);
  }
  if (remote.status !== 2) {
    throw new Error(`Remote release-tag availability for ${releaseTag} could not be verified.`);
  }

  return releaseTag;
}

function resetReleaseDirectory(
  releaseDirectory,
  { projectRoot = PROJECT_ROOT, fsImpl = fs } = {},
) {
  const expected = path.join(path.resolve(projectRoot), RELEASE_DIRECTORY_NAME);
  if (path.resolve(releaseDirectory) !== expected) {
    throw new Error('Release preflight may clean only the project release-dry-run directory.');
  }

  if (fsImpl.existsSync(expected)) {
    const stats = fsImpl.lstatSync(expected);
    if (stats.isSymbolicLink()) {
      throw new Error('release-dry-run must not be a symbolic link.');
    }
    fsImpl.rmSync(expected, { recursive: true, force: false });
  }
  fsImpl.mkdirSync(expected, { recursive: true });
}

function verifyUnsignedBundle(
  releaseDirectory,
  desktopVersion,
  commandRunner = run,
) {
  const infoPlist = path.join(releaseDirectory, MAC_INFO_PLIST_RELATIVE_PATH);
  const executable = path.join(releaseDirectory, MAC_EXECUTABLE_RELATIVE_PATH);
  const builtVersion = commandRunner(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', infoPlist],
    { capture: true, label: 'Packaged desktop version check' },
  ).stdout.trim();
  if (builtVersion !== desktopVersion) {
    throw new Error(
      `Packaged desktop version ${builtVersion || '(missing)'} does not match ${desktopVersion}.`,
    );
  }

  const architectures = commandRunner('lipo', ['-archs', executable], {
    capture: true,
    label: 'Packaged desktop architecture check',
  }).stdout.trim().split(/\s+/);
  if (!architectures.includes('x86_64') || !architectures.includes('arm64')) {
    throw new Error('The local desktop package must contain both x86_64 and arm64 slices.');
  }

  return { architectures, builtVersion };
}

function readJson(filePath, fsImpl = fs) {
  return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
}

function runReleasePreflight({
  commandRunner = run,
  fsImpl = fs,
  inspectAssets = inspectLocalAssets,
  logger = console,
  packageManifest,
  lockManifest,
  platform = process.platform,
  projectRoot = PROJECT_ROOT,
  verifyBundle = verifyUnsignedBundle,
  writeAssetChecksums = writeChecksums,
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('The macOS desktop release preflight must run on macOS.');
  }

  const resolvedPackageManifest = packageManifest ||
    readJson(path.join(projectRoot, 'desktop/package.json'), fsImpl);
  const resolvedLockManifest = lockManifest ||
    readJson(path.join(projectRoot, 'desktop/package-lock.json'), fsImpl);
  const desktopVersion = validateVersionContracts(
    resolvedPackageManifest,
    resolvedLockManifest,
  );
  const releaseTag = assertReleaseTagAvailable(desktopVersion, commandRunner);

  commandRunner('npm', ['run', 'env:check'], { label: 'Development environment check' });
  commandRunner(
    'npm',
    ['ci', '--prefix', 'desktop', '--ignore-scripts', '--dry-run'],
    { label: 'Desktop lockfile check' },
  );
  commandRunner('npm', ['run', 'verify:full-stack'], { label: 'Full-stack verification' });

  const releaseDirectory = path.join(projectRoot, RELEASE_DIRECTORY_NAME);
  resetReleaseDirectory(releaseDirectory, { fsImpl, projectRoot });
  commandRunner(
    'npm',
    [
      'exec',
      '--',
      'electron-builder',
      '--projectDir',
      'desktop',
      '--config',
      'electron-builder.dry-run.yml',
      '--mac',
      '--universal',
      '--publish',
      'never',
    ],
    { label: 'Unsigned desktop distribution build' },
  );

  writeAssetChecksums(releaseDirectory, desktopVersion);
  const assets = inspectAssets(releaseDirectory, desktopVersion);
  const bundle = verifyBundle(releaseDirectory, desktopVersion, commandRunner);

  logger.log(`[desktop-preflight] ${releaseTag} passed local release preflight.`);
  logger.log(`[desktop-preflight] Validated ${assets.length} unsigned local artifacts.`);
  logger.log(
    '[desktop-preflight] These artifacts are non-distributable and do not prove Apple signing or automatic updates.',
  );

  return { assets, bundle, desktopVersion, releaseDirectory, releaseTag };
}

if (require.main === module) {
  try {
    runReleasePreflight();
  } catch (error) {
    console.error(`[desktop-preflight] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertReleaseTagAvailable,
  resetReleaseDirectory,
  runReleasePreflight,
  validateVersionContracts,
  verifyUnsignedBundle,
};
