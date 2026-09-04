const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  expectedReleaseAssetNames,
  inspectLocalAssets,
} = require('./release-workflow.cjs');
const { validateReleaseTag } = require('./release.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPOSITORY = 'StefanosCodes/GlideLingo';
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const RELEASE_TAG_PATTERN = /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(
  command,
  args,
  { allowFailure = false, capture = false, cwd = PROJECT_ROOT, label } = {},
) {
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

function downloadWithGh(repository, asset, outputPath, fsImpl = fs) {
  if (!Number.isSafeInteger(asset?.id) || asset.id <= 0) {
    throw new Error('GitHub release asset id must be a positive safe integer.');
  }

  const descriptor = fsImpl.openSync(outputPath, 'wx', 0o600);
  let result;
  try {
    result = spawnSync(
      'gh',
      [
        'api',
        '--header',
        'Accept: application/octet-stream',
        `repos/${repository}/releases/assets/${asset.id}`,
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', descriptor, 'pipe'],
      },
    );
  } finally {
    fsImpl.closeSync(descriptor);
  }

  if (result.error || result.status !== 0) {
    fsImpl.rmSync(outputPath, { force: true });
    throw new Error(`Could not download release asset ${asset.name}.`);
  }
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function findDraftCandidatePages(pages, selection) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error('GitHub paginated releases response must be an array of pages.');
  }

  const allowedNames = new Set([
    `GlideLingo ${selection.releaseTag}`,
    `GlideLingo ${selection.releaseTag} (internal sandbox)`,
  ]);
  const matches = pages.flat().filter(
    (release) =>
      release?.draft === true &&
      release.target_commitish === selection.commitSha &&
      allowedNames.has(release.name) &&
      (release.tag_name === selection.releaseTag || /^untagged-[0-9a-f]+$/i.test(release.tag_name)),
  );

  if (matches.length > 1) {
    throw new Error(`Multiple GitHub drafts match ${selection.releaseTag}.`);
  }
  return matches[0] || null;
}

function createGitHubAcceptanceClient({
  commandRunner = run,
  downloadAsset = downloadWithGh,
  repository = REPOSITORY,
} = {}) {
  return {
    inspectDraft(selection) {
      const endpoint = `repos/${repository}/releases/tags/${encodeURIComponent(selection.releaseTag)}`;
      const byTag = commandRunner('gh', ['api', endpoint], {
        allowFailure: true,
        capture: true,
        label: 'GitHub release lookup',
      });
      let candidate;
      if (byTag.status === 0) {
        candidate = parseJsonOutput(byTag, 'GitHub release lookup');
      } else {
        const detail = `${byTag.stdout || ''}\n${byTag.stderr || ''}`;
        if (!/HTTP 404|release not found|Not Found/i.test(detail)) {
          throw new Error(`GitHub release ${selection.releaseTag} could not be inspected.`);
        }

        const listed = commandRunner(
          'gh',
          [
            'api',
            '--paginate',
            '--slurp',
            `repos/${repository}/releases?per_page=100`,
          ],
          { capture: true, label: 'GitHub draft-list lookup' },
        );
        candidate = findDraftCandidatePages(
          parseJsonOutput(listed, 'GitHub draft-list lookup'),
          selection,
        );
      }

      if (!candidate) return null;
      if (!Number.isSafeInteger(candidate.id) || candidate.id <= 0) {
        throw new Error(`GitHub release ${selection.releaseTag} has no immutable release id.`);
      }
      const immutable = commandRunner(
        'gh',
        ['api', `repos/${repository}/releases/${candidate.id}`],
        { capture: true, label: 'Immutable GitHub release lookup' },
      );
      return parseJsonOutput(immutable, 'Immutable GitHub release lookup');
    },
    downloadAsset(asset, outputPath) {
      return downloadAsset(repository, asset, outputPath);
    },
  };
}

function readVersionManifest(result, label) {
  const manifest = parseJsonOutput(result, label);
  return manifest?.version;
}

function resolveReleaseSelection(releaseTag, commandRunner = run) {
  const tagMatch = RELEASE_TAG_PATTERN.exec(releaseTag || '');
  if (!tagMatch) {
    throw new Error('Provide one strict release tag such as desktop-v1.0.7.');
  }
  const desktopVersion = releaseTag.slice('desktop-v'.length);
  validateReleaseTag(releaseTag, desktopVersion);

  commandRunner('git', ['fetch', 'origin', 'main', '--tags'], {
    label: 'Release reference fetch',
  });
  const commitSha = commandRunner(
    'git',
    ['rev-parse', '--verify', `refs/tags/${releaseTag}^{commit}`],
    { capture: true, label: 'Protected release-tag resolution' },
  ).stdout.trim();
  if (!FULL_COMMIT_PATTERN.test(commitSha)) {
    throw new Error(`${releaseTag} did not resolve to an exact Git commit.`);
  }

  const ancestry = commandRunner(
    'git',
    ['merge-base', '--is-ancestor', commitSha, 'refs/remotes/origin/main'],
    { allowFailure: true, capture: true, label: 'Release main-ancestry check' },
  );
  if (ancestry.status === 1) {
    throw new Error(`${releaseTag} is not reachable from origin/main.`);
  }
  if (ancestry.status !== 0) {
    throw new Error(`${releaseTag} main-branch ancestry could not be verified.`);
  }

  const packageVersion = readVersionManifest(
    commandRunner('git', ['show', `${releaseTag}:desktop/package.json`], {
      capture: true,
      label: 'Tagged desktop manifest check',
    }),
    'Tagged desktop manifest check',
  );
  const lockVersion = readVersionManifest(
    commandRunner('git', ['show', `${releaseTag}:desktop/package-lock.json`], {
      capture: true,
      label: 'Tagged desktop lockfile check',
    }),
    'Tagged desktop lockfile check',
  );
  if (packageVersion !== desktopVersion || lockVersion !== desktopVersion) {
    throw new Error(`${releaseTag} does not match both tagged desktop version files.`);
  }

  return { commitSha, releaseTag, version: desktopVersion };
}

function validateDraftRelease(release, selection) {
  if (!release) {
    throw new Error(`Private draft ${selection.releaseTag} was not found.`);
  }
  if (release.draft !== true) {
    throw new Error(`${selection.releaseTag} is already published; draft acceptance is closed.`);
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new Error(`${selection.releaseTag} has no immutable GitHub release id.`);
  }
  if (release.target_commitish !== selection.commitSha) {
    throw new Error(`${selection.releaseTag} does not target the protected tagged commit.`);
  }

  const billingMode = release.prerelease === true ? 'sandbox' : 'production';
  const expectedName = billingMode === 'sandbox'
    ? `GlideLingo ${selection.releaseTag} (internal sandbox)`
    : `GlideLingo ${selection.releaseTag}`;
  if (release.name !== expectedName) {
    throw new Error(`${selection.releaseTag} has an unexpected release identity.`);
  }
  if (
    release.tag_name !== selection.releaseTag &&
    !/^untagged-[0-9a-f]+$/i.test(release.tag_name || '')
  ) {
    throw new Error(`${selection.releaseTag} has an unexpected GitHub draft tag.`);
  }

  const expectedNames = [...expectedReleaseAssetNames(selection.version)].sort();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const actualNames = assets.map((asset) => asset.name).sort();
  if (
    expectedNames.length !== actualNames.length ||
    expectedNames.some((name, index) => name !== actualNames[index])
  ) {
    throw new Error(`${selection.releaseTag} does not contain the exact six release assets.`);
  }
  for (const asset of assets) {
    if (
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      asset.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')
    ) {
      throw new Error(`Remote release asset ${asset.name} is incomplete.`);
    }
  }

  return { assets, billingMode };
}

function prepareAcceptanceDirectory(releaseTag, { fsImpl = fs, projectRoot = PROJECT_ROOT } = {}) {
  if (!RELEASE_TAG_PATTERN.test(releaseTag || '')) {
    throw new Error('Release acceptance requires a strict desktop release tag.');
  }
  const root = path.join(path.resolve(projectRoot), 'release-acceptance');
  if (fsImpl.existsSync(root) && fsImpl.lstatSync(root).isSymbolicLink()) {
    throw new Error('release-acceptance must not be a symbolic link.');
  }
  fsImpl.mkdirSync(root, { recursive: true });
  const destination = path.join(root, releaseTag);
  if (fsImpl.existsSync(destination)) {
    if (fsImpl.lstatSync(destination).isSymbolicLink()) {
      throw new Error('The release acceptance destination must not be a symbolic link.');
    }
    fsImpl.rmSync(destination, { recursive: true, force: false });
  }
  fsImpl.mkdirSync(destination, { recursive: true });
  return destination;
}

function validateRemoteAssets(releaseAssets, localAssets) {
  const localByName = new Map(localAssets.map((asset) => [asset.name, asset]));
  for (const remote of releaseAssets) {
    const local = localByName.get(remote.name);
    if (
      !local ||
      remote.size !== local.size ||
      remote.digest !== `sha256:${local.sha256}`
    ) {
      throw new Error(`Downloaded release asset ${remote.name} does not match GitHub.`);
    }
  }
}

function verifyMacBundle(appPath, desktopVersion, commandRunner = run) {
  const executable = path.join(appPath, 'Contents/MacOS/GlideLingo');
  const infoPlist = path.join(appPath, 'Contents/Info.plist');
  commandRunner('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    label: 'Developer ID signature verification',
  });
  const signature = commandRunner(
    'codesign',
    ['--display', '--verbose=4', appPath],
    { capture: true, label: 'Developer ID identity verification' },
  );
  const signatureDetails = `${signature.stdout || ''}\n${signature.stderr || ''}`;
  if (
    !/^Authority=Developer ID Application:/m.test(signatureDetails) ||
    !/^TeamIdentifier=[A-Z0-9]+$/m.test(signatureDetails)
  ) {
    throw new Error('Downloaded app is not signed with a Developer ID Application identity.');
  }
  commandRunner('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], {
    label: 'Gatekeeper verification',
  });
  commandRunner('xcrun', ['stapler', 'validate', appPath], {
    label: 'Notarization-ticket verification',
  });
  const builtVersion = commandRunner(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', infoPlist],
    { capture: true, label: 'Downloaded app version check' },
  ).stdout.trim();
  if (builtVersion !== desktopVersion) {
    throw new Error(`Downloaded app version does not match ${desktopVersion}.`);
  }
  const architectures = commandRunner('lipo', ['-archs', executable], {
    capture: true,
    label: 'Downloaded app architecture check',
  }).stdout.trim().split(/\s+/);
  if (!architectures.includes('x86_64') || !architectures.includes('arm64')) {
    throw new Error('Downloaded app must contain both x86_64 and arm64 slices.');
  }
}

function verifyDownloadedArtifacts(
  releaseDirectory,
  desktopVersion,
  { commandRunner = run, fsImpl = fs, verifyBundle = verifyMacBundle } = {},
) {
  const temporaryRoot = fsImpl.mkdtempSync(
    path.join(os.tmpdir(), 'glidelingo-release-acceptance-'),
  );
  const zipDirectory = path.join(temporaryRoot, 'zip');
  const mountPoint = path.join(temporaryRoot, 'dmg');
  fsImpl.mkdirSync(zipDirectory);
  fsImpl.mkdirSync(mountPoint);
  let mounted = false;

  try {
    commandRunner(
      'ditto',
      [
        '-x',
        '-k',
        path.join(releaseDirectory, `GlideLingo-${desktopVersion}-universal.zip`),
        zipDirectory,
      ],
      { label: 'Updater ZIP extraction' },
    );
    verifyBundle(path.join(zipDirectory, 'GlideLingo.app'), desktopVersion, commandRunner);

    commandRunner(
      'hdiutil',
      [
        'attach',
        '-nobrowse',
        '-readonly',
        '-mountpoint',
        mountPoint,
        path.join(releaseDirectory, `GlideLingo-${desktopVersion}-universal.dmg`),
      ],
      { label: 'DMG mount' },
    );
    mounted = true;
    verifyBundle(path.join(mountPoint, 'GlideLingo.app'), desktopVersion, commandRunner);
  } finally {
    try {
      if (mounted) {
        commandRunner('hdiutil', ['detach', mountPoint], {
          allowFailure: true,
          capture: true,
          label: 'DMG detach',
        });
      }
    } finally {
      fsImpl.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function runDraftAcceptance(releaseTag, {
  commandRunner = run,
  createClient = createGitHubAcceptanceClient,
  fsImpl = fs,
  inspectAssets = inspectLocalAssets,
  logger = console,
  platform = process.platform,
  projectRoot = PROJECT_ROOT,
  resolveSelection = resolveReleaseSelection,
  verifyArtifacts = verifyDownloadedArtifacts,
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('Signed macOS draft acceptance must run on macOS.');
  }
  commandRunner('gh', ['auth', 'status'], { label: 'GitHub authentication check' });
  const selection = resolveSelection(releaseTag, commandRunner);
  const currentManifest = JSON.parse(
    fsImpl.readFileSync(path.join(projectRoot, 'desktop/package.json'), 'utf8'),
  );
  if (currentManifest.version !== selection.version) {
    throw new Error('Check out the exact release version before accepting its draft.');
  }

  const client = createClient({ commandRunner });
  const release = client.inspectDraft(selection);
  const { assets, billingMode } = validateDraftRelease(release, selection);
  const releaseDirectory = prepareAcceptanceDirectory(releaseTag, { fsImpl, projectRoot });

  for (const asset of assets) {
    try {
      client.downloadAsset(asset, path.join(releaseDirectory, asset.name));
    } catch {
      throw new Error(`Could not download release asset ${asset.name}.`);
    }
  }

  const localAssets = inspectAssets(releaseDirectory, selection.version);
  validateRemoteAssets(assets, localAssets);
  verifyArtifacts(releaseDirectory, selection.version);

  logger.log(`[desktop-acceptance] ${releaseTag} passed signed draft verification.`);
  logger.log(`[desktop-acceptance] Billing mode: ${billingMode}.`);
  logger.log(
    `[desktop-acceptance] Downloaded artifacts remain at ${releaseDirectory} for manual installation.`,
  );
  logger.log('[desktop-acceptance] Nothing was published or installed automatically.');

  return { billingMode, localAssets, releaseDirectory, selection };
}

if (require.main === module) {
  try {
    const [releaseTag, ...extraArguments] = process.argv.slice(2);
    if (!releaseTag || extraArguments.length > 0) {
      throw new Error('Provide exactly one desktop release tag.');
    }
    runDraftAcceptance(releaseTag);
  } catch (error) {
    console.error(`[desktop-acceptance] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  createGitHubAcceptanceClient,
  findDraftCandidatePages,
  prepareAcceptanceDirectory,
  resolveReleaseSelection,
  runDraftAcceptance,
  validateDraftRelease,
  validateRemoteAssets,
  verifyDownloadedArtifacts,
  verifyMacBundle,
};
