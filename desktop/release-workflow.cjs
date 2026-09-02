const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { version } = require('./package.json');
const { validateReleaseTag } = require('./release.cjs');
const { resolveBillingMode } = require('./release-secrets.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const DRAFT_LOOKUP_ATTEMPTS = 10;
const DRAFT_LOOKUP_DELAY_MS = 2_000;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }

  return result;
}

function createGitAdapter() {
  return {
    resolveCommit(reference) {
      return run('git', ['rev-parse', '--verify', `${reference}^{commit}`]).stdout.trim();
    },
    readDesktopVersion(commit) {
      const manifest = run('git', ['show', `${commit}:desktop/package.json`]).stdout;
      return JSON.parse(manifest).version;
    },
    isAncestor(ancestor, descendant) {
      const result = run('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
        allowFailure: true,
      });
      if (result.status !== 0 && result.status !== 1) {
        throw new Error('Unable to verify the selected commit against complete main history.');
      }
      return result.status === 0;
    },
  };
}

function resolveReleaseSelection(input, git = createGitAdapter()) {
  let selectedCommit;
  let releaseTag;

  if (input.eventName === 'push') {
    if (input.refType !== 'tag') {
      throw new Error('Automatic desktop releases only accept a protected tag event.');
    }
    selectedCommit = input.eventSha;
    releaseTag = input.refName;
  } else if (input.eventName === 'workflow_dispatch') {
    selectedCommit = input.manualCommit;
    releaseTag = input.manualTag;
  } else {
    throw new Error(`Unsupported desktop release event: ${input.eventName || '(missing)'}.`);
  }

  if (!FULL_COMMIT_PATTERN.test(selectedCommit || '')) {
    throw new Error('The selected release commit must be an exact 40-character Git commit SHA.');
  }
  if (!releaseTag) {
    throw new Error('An existing protected desktop release tag is required.');
  }

  const resolvedCommit = git.resolveCommit(selectedCommit);
  const taggedCommit = git.resolveCommit(`refs/tags/${releaseTag}`);
  const mainCommit = git.resolveCommit('refs/remotes/origin/main');

  if (resolvedCommit.toLowerCase() !== selectedCommit.toLowerCase()) {
    throw new Error('The selected release commit did not resolve to the exact requested commit.');
  }
  if (taggedCommit !== resolvedCommit) {
    throw new Error(`Protected tag ${releaseTag} does not point to the selected release commit.`);
  }
  if (!git.isAncestor(resolvedCommit, mainCommit)) {
    throw new Error('The selected release commit is not reachable from the complete origin/main history.');
  }

  const selectedVersion = git.readDesktopVersion(resolvedCommit);
  validateReleaseTag(releaseTag, selectedVersion);

  return { commitSha: resolvedCommit, releaseTag, version: selectedVersion };
}

function expectedReleaseAssetNames(desktopVersion = version) {
  return [
    `GlideLingo-${desktopVersion}-universal.dmg`,
    `GlideLingo-${desktopVersion}-universal.dmg.blockmap`,
    `GlideLingo-${desktopVersion}-universal.zip`,
    `GlideLingo-${desktopVersion}-universal.zip.blockmap`,
    'latest-mac.yml',
    'SHA256SUMS.txt',
  ];
}

function distributableAssetNames(desktopVersion = version) {
  return [
    `GlideLingo-${desktopVersion}-universal.dmg`,
    `GlideLingo-${desktopVersion}-universal.zip`,
  ];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha512(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function writeChecksums(releaseDirectory, desktopVersion = version) {
  const directory = path.resolve(releaseDirectory);
  const distributables = distributableAssetNames(desktopVersion);
  const manifestName = 'SHA256SUMS.txt';

  for (const name of distributables) {
    const filePath = path.join(directory, name);
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0) {
      throw new Error(`Release asset ${name} must be a non-empty file.`);
    }
  }

  const manifest = distributables
    .map((name) => `${sha256(path.join(directory, name))}  ${name}`)
    .join('\n');
  fs.writeFileSync(path.join(directory, manifestName), `${manifest}\n`, { flag: 'w' });
}

function assertExactNames(actualNames, expectedNames) {
  const actual = [...actualNames].sort();
  const expected = [...expectedNames].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(`Release assets must be exactly: ${expected.join(', ')}.`);
  }
}

function inspectLocalAssets(releaseDirectory, desktopVersion = version) {
  const directory = path.resolve(releaseDirectory);
  const expectedNames = expectedReleaseAssetNames(desktopVersion);
  const publishableNames = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith('.dmg') ||
          entry.name.endsWith('.zip') ||
          entry.name.endsWith('.blockmap') ||
          entry.name === 'latest-mac.yml' ||
          entry.name === 'SHA256SUMS.txt'),
    )
    .map((entry) => entry.name)
    .sort();

  assertExactNames(publishableNames, expectedNames);

  const assets = expectedNames.map((name) => {
    const filePath = path.join(directory, name);
    const size = fs.statSync(filePath).size;
    if (size === 0) {
      throw new Error(`Release asset ${name} must be non-empty.`);
    }
    return { name, path: filePath, size, sha256: sha256(filePath) };
  });

  const expectedChecksums = new Map(
    distributableAssetNames(desktopVersion).map((name) => [
      name,
      sha256(path.join(directory, name)),
    ]),
  );
  const manifestLines = fs
    .readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
    .trim()
    .split('\n');

  if (manifestLines.length !== expectedChecksums.size) {
    throw new Error('SHA256SUMS.txt must contain exactly the DMG and ZIP checksums.');
  }

  const seen = new Set();
  for (const line of manifestLines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match || !expectedChecksums.has(match[2]) || seen.has(match[2])) {
      throw new Error('SHA256SUMS.txt contains an unexpected or duplicate asset entry.');
    }
    if (expectedChecksums.get(match[2]) !== match[1]) {
      throw new Error(`SHA256SUMS.txt does not match ${match[2]}.`);
    }
    seen.add(match[2]);
  }

  const updateManifest = fs.readFileSync(path.join(directory, 'latest-mac.yml'), 'utf8');
  const versionMatch = /^version:\s*([^\s]+)$/m.exec(updateManifest);
  const updateUrls = [...updateManifest.matchAll(/^\s*- url:\s*([^\s]+)$/gm)].map(
    (match) => match[1],
  );
  const primaryPath = /^path:\s*([^\s]+)$/m.exec(updateManifest)?.[1];
  const primarySha512 = /^sha512:\s*([^\s]+)$/m.exec(updateManifest)?.[1];
  const updateFiles = new Map(
    [...updateManifest.matchAll(
      /^\s*- url:\s*([^\s]+)\s*\n\s+sha512:\s*([^\s]+)\s*\n\s+size:\s*([0-9]+)\s*$/gm,
    )].map((match) => [
      match[1],
      { sha512: match[2], size: Number.parseInt(match[3], 10) },
    ]),
  );
  const distributables = distributableAssetNames(desktopVersion);

  if (versionMatch?.[1] !== desktopVersion) {
    throw new Error('latest-mac.yml must match the packaged desktop version.');
  }
  assertExactNames(updateUrls, distributables);
  if (primaryPath !== distributables[1]) {
    throw new Error('latest-mac.yml must select the universal ZIP as its primary update.');
  }
  if (updateFiles.size !== distributables.length) {
    throw new Error('latest-mac.yml must contain SHA-512 and size metadata for each update.');
  }

  for (const name of distributables) {
    const metadata = updateFiles.get(name);
    const filePath = path.join(directory, name);
    const expectedSha512 = sha512(filePath);
    const expectedSize = fs.statSync(filePath).size;
    if (metadata?.sha512 !== expectedSha512 || metadata?.size !== expectedSize) {
      throw new Error(`latest-mac.yml metadata does not match ${name}.`);
    }
  }
  if (primarySha512 !== updateFiles.get(distributables[1])?.sha512) {
    throw new Error('latest-mac.yml primary SHA-512 must match the universal ZIP.');
  }

  return assets;
}

function assertRemoteDraft(release, localAssets, selection) {
  assertDraftIdentity(release, selection);

  const remoteAssets = release.assets || [];
  assertExactNames(
    remoteAssets.map((asset) => asset.name),
    localAssets.map((asset) => asset.name),
  );

  const localByName = new Map(localAssets.map((asset) => [asset.name, asset]));
  for (const asset of remoteAssets) {
    const localAsset = localByName.get(asset.name);
    if (
      asset.state !== 'uploaded' ||
      asset.size !== localAsset.size ||
      asset.digest !== `sha256:${localAsset.sha256}`
    ) {
      throw new Error(`Remote release asset ${asset.name} is incomplete or does not match locally.`);
    }
  }
}

function releaseTitle(selection) {
  return selection.billingMode === 'sandbox'
    ? `GlideLingo ${selection.releaseTag} (internal sandbox)`
    : `GlideLingo ${selection.releaseTag}`;
}

function assertDraftIdentity(release, selection) {
  const tagMatches =
    release?.tag_name === selection.releaseTag ||
    /^untagged-[0-9a-f]+$/i.test(release?.tag_name || '');
  if (
    !release ||
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    release.draft !== true ||
    !tagMatches ||
    release.name !== releaseTitle(selection) ||
    release.target_commitish !== selection.commitSha
  ) {
    throw new Error('The GitHub release must match the exact unpublished draft identity.');
  }
  if (release.prerelease !== (selection.billingMode === 'sandbox')) {
    throw new Error(
      `The ${selection.billingMode} draft prerelease flag does not match its release channel.`,
    );
  }
}

function findReleaseByTag(releases, tag) {
  if (!Array.isArray(releases)) {
    throw new Error('GitHub releases response must be an array.');
  }

  return releases.find((release) => release?.tag_name === tag) ?? null;
}

function findReleaseByTagPages(pages, tag) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error('GitHub paginated releases response must be an array of pages.');
  }

  for (const page of pages) {
    const release = findReleaseByTag(page, tag);
    if (release) {
      return release;
    }
  }

  return null;
}

function findDraftBySelectionPages(pages, selection) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error('GitHub paginated releases response must be an array of pages.');
  }

  const matches = pages
    .flat()
    .filter((release) => {
      try {
        assertDraftIdentity(release, selection);
        return true;
      } catch {
        return false;
      }
    });
  if (matches.length > 1) {
    throw new Error(`Multiple GitHub drafts match ${selection.releaseTag}.`);
  }
  return matches[0] ?? null;
}

async function convergeDraftRelease(selection, localAssets, github) {
  resolveBillingMode(selection.billingMode);
  let release = await github.getRelease(selection);

  if (release && release.draft !== true) {
    throw new Error(`Release ${selection.releaseTag} is already published and cannot be replaced.`);
  }

  if (!release) {
    release = await github.createDraft(selection);
  } else {
    assertDraftIdentity(release, selection);
    await github.updateDraft(release.id, selection);
    release = await github.getReleaseById(release.id);
  }

  if (!release) {
    throw new Error(`Draft release ${selection.releaseTag} could not be created.`);
  }
  assertDraftIdentity(release, selection);

  for (const asset of release.assets || []) {
    await github.deleteAsset(asset.id);
  }

  await github.uploadAssets(release.id, localAssets.map((asset) => asset.path));
  const converged = await github.getReleaseById(release.id);
  assertRemoteDraft(converged, localAssets, selection);
  return converged;
}

function createGitHubAdapter(
  repository,
  api = (args, options) => run('gh', ['api', ...args], options),
  execute = (args) => run('gh', args),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  return {
    async getRelease(selection) {
      const tag = selection.releaseTag;
      const endpoint = `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
      const result = api([endpoint], { allowFailure: true });
      if (result.status !== 0) {
        const detail = `${result.stdout}\n${result.stderr}`;
        if (/HTTP 404|release not found|Not Found/i.test(detail)) {
          const listed = api([
            '--paginate',
            '--slurp',
            `repos/${repository}/releases?per_page=100`,
          ]);
          const pages = JSON.parse(listed.stdout);
          return findReleaseByTagPages(pages, tag) ?? findDraftBySelectionPages(pages, selection);
        }
        throw new Error(`Unable to inspect draft release ${tag}: ${detail.trim()}`);
      }
      return JSON.parse(result.stdout);
    },
    async getReleaseById(releaseId) {
      if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
        throw new Error('GitHub release id must be a positive safe integer.');
      }
      return JSON.parse(api([`repos/${repository}/releases/${releaseId}`]).stdout);
    },
    async createDraft(selection) {
      const args = [
        'release',
        'create',
        selection.releaseTag,
        '--repo',
        repository,
        '--draft',
        '--verify-tag',
        '--target',
        selection.commitSha,
        '--title',
        releaseTitle(selection),
      ];
      if (selection.billingMode === 'sandbox') {
        args.push(
          '--prerelease',
          '--notes',
          'INTERNAL SANDBOX BUILD. Do not publish or link from the public website.',
        );
      } else {
        args.push('--generate-notes');
      }
      execute(args);
      for (let attempt = 1; attempt <= DRAFT_LOOKUP_ATTEMPTS; attempt += 1) {
        const release = await this.getRelease(selection);
        if (release) {
          return release;
        }
        if (attempt < DRAFT_LOOKUP_ATTEMPTS) {
          await wait(DRAFT_LOOKUP_DELAY_MS);
        }
      }
      return null;
    },
    async updateDraft(releaseId, selection) {
      const args = [
        '--method',
        'PATCH',
        `repos/${repository}/releases/${releaseId}`,
        '-f',
        selection.billingMode === 'sandbox'
          ? `name=GlideLingo ${selection.releaseTag} (internal sandbox)`
          : `name=GlideLingo ${selection.releaseTag}`,
        '-F',
        'draft=true',
        '-F',
        `prerelease=${selection.billingMode === 'sandbox'}`,
      ];
      if (selection.billingMode === 'sandbox') {
        args.push(
          '-f',
          'body=INTERNAL SANDBOX BUILD. Do not publish or link from the public website.',
        );
      }
      api(args);
    },
    async deleteAsset(assetId) {
      api(['--method', 'DELETE', `repos/${repository}/releases/assets/${assetId}`]);
    },
    async uploadAssets(releaseId, assetPaths) {
      for (const assetPath of assetPaths) {
        const assetName = path.basename(assetPath);
        api([
          '--method',
          'POST',
          '--header',
          'Accept: application/vnd.github+json',
          '--header',
          'Content-Type: application/octet-stream',
          '--input',
          assetPath,
          `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
        ]);
      }
    },
  };
}

function workflowInput(environment = process.env) {
  return {
    eventName: environment.GLIDELINGO_EVENT_NAME,
    eventSha: environment.GLIDELINGO_EVENT_SHA,
    refName: environment.GLIDELINGO_REF_NAME,
    refType: environment.GLIDELINGO_REF_TYPE,
    manualCommit: environment.GLIDELINGO_SELECTED_COMMIT,
    manualTag: environment.GLIDELINGO_SELECTED_TAG,
  };
}

function writeWorkflowOutputs(selection, outputPath) {
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(
    outputPath,
    `commit_sha=${selection.commitSha}\nrelease_tag=${selection.releaseTag}\nversion=${selection.version}\n`,
  );
}

async function main(argv = process.argv.slice(2), environment = process.env) {
  const [command, releaseDirectory = 'release'] = argv;

  if (command === 'validate-selection') {
    const selection = resolveReleaseSelection(workflowInput(environment));
    writeWorkflowOutputs(selection, environment.GITHUB_OUTPUT);
    console.log(`[desktop-release] Validated ${selection.releaseTag} at ${selection.commitSha}.`);
    return;
  }
  if (command === 'write-checksums') {
    writeChecksums(releaseDirectory);
    return;
  }
  if (command === 'validate-assets') {
    inspectLocalAssets(releaseDirectory);
    return;
  }
  if (command === 'stage-draft') {
    const commitSha = environment.GLIDELINGO_RELEASE_COMMIT;
    const releaseTag = environment.GLIDELINGO_RELEASE_TAG;
    const billingMode = resolveBillingMode(environment.GLIDELINGO_BILLING_MODE);
    if (!FULL_COMMIT_PATTERN.test(commitSha || '')) {
      throw new Error('GLIDELINGO_RELEASE_COMMIT must be an exact commit SHA.');
    }
    validateReleaseTag(releaseTag, version);
    const repository = environment.GITHUB_REPOSITORY;
    if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw new Error('GITHUB_REPOSITORY must identify the release repository.');
    }
    await convergeDraftRelease(
      { billingMode, commitSha, releaseTag, version },
      inspectLocalAssets(releaseDirectory),
      createGitHubAdapter(repository),
    );
    console.log(`[desktop-release] ${releaseTag} converged to an exact draft release.`);
    return;
  }

  throw new Error('Expected validate-selection, write-checksums, validate-assets, or stage-draft.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[desktop-release] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertRemoteDraft,
  convergeDraftRelease,
  createGitHubAdapter,
  expectedReleaseAssetNames,
  findReleaseByTag,
  findReleaseByTagPages,
  inspectLocalAssets,
  resolveReleaseSelection,
  writeChecksums,
};
