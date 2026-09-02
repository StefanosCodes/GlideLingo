const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  convergeDraftRelease,
  createGitHubAdapter,
  expectedReleaseAssetNames,
  findReleaseByTag,
  findReleaseByTagPages,
  inspectLocalAssets,
  resolveReleaseSelection,
  writeChecksums,
} = require('./release-workflow.cjs');

const commitSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);
const releaseTag = 'desktop-v1.0.0';

function sandboxSelection(overrides = {}) {
  return { billingMode: 'sandbox', commitSha, releaseTag, version: '1.0.0', ...overrides };
}

function sandboxDraft(overrides = {}) {
  return {
    id: 7,
    tag_name: releaseTag,
    name: `GlideLingo ${releaseTag} (internal sandbox)`,
    target_commitish: commitSha,
    draft: true,
    prerelease: true,
    assets: [],
    ...overrides,
  };
}

test('draft releases can be recovered from the release list when the tag endpoint omits them', () => {
  const draft = { id: 42, draft: true, tag_name: releaseTag };

  assert.equal(findReleaseByTag([{ tag_name: 'desktop-v0.9.0' }, draft], releaseTag), draft);
  assert.equal(findReleaseByTag([], releaseTag), null);
  assert.throws(() => findReleaseByTag({}, releaseTag), /must be an array/);
});

test('draft recovery searches every paginated release-list response', () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    tag_name: `desktop-v0.${index}.0`,
  }));
  const draft = { id: 101, draft: true, tag_name: releaseTag };

  assert.equal(findReleaseByTagPages([firstPage, [draft]], releaseTag), draft);
  assert.equal(findReleaseByTagPages([firstPage, []], releaseTag), null);
  assert.throws(
    () => findReleaseByTagPages([firstPage, {}], releaseTag),
    /array of pages/,
  );
});

test('GitHub draft lookup follows pagination and recognizes GitHub untagged draft identities', async () => {
  const draft = sandboxDraft({ id: 101, tag_name: 'untagged-deadbeef' });
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    draft: false,
    tag_name: `desktop-v0.${index}.0`,
  }));
  const calls = [];
  const github = createGitHubAdapter('StefanosCodes/GlideLingo', (args, options) => {
    calls.push({ args, options });
    if (calls.length === 1) {
      return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    }
    return { status: 0, stdout: JSON.stringify([firstPage, [draft]]), stderr: '' };
  });

  assert.deepEqual(await github.getRelease(sandboxSelection()), draft);
  assert.deepEqual(calls[1].args, [
    '--paginate',
    '--slurp',
    'repos/StefanosCodes/GlideLingo/releases?per_page=100',
  ]);
});

test('GitHub draft adapter marks sandbox builds as internal prereleases only', async () => {
  const commands = [];
  const responses = [];
  const api = (args) => {
    responses.push(args);
    return {
      status: 0,
      stdout: JSON.stringify(sandboxDraft()),
      stderr: '',
    };
  };
  const adapter = createGitHubAdapter(
    'StefanosCodes/GlideLingo',
    api,
    (args) => commands.push(args),
  );

  await adapter.createDraft({
    billingMode: 'sandbox',
    commitSha,
    releaseTag,
  });
  assert.ok(commands[0].includes('--prerelease'));
  assert.ok(commands[0].includes('INTERNAL SANDBOX BUILD. Do not publish or link from the public website.'));

  commands.length = 0;
  await adapter.createDraft({
    billingMode: 'production',
    commitSha,
    releaseTag,
  });
  assert.ok(commands[0].includes('--generate-notes'));
  assert.ok(!commands[0].includes('--prerelease'));

  await adapter.updateDraft(7, {
    billingMode: 'sandbox',
    releaseTag,
  });
  assert.ok(responses.at(-1).includes('prerelease=true'));
  assert.ok(responses.at(-1).some((argument) => argument.startsWith('body=')));

  await adapter.updateDraft(7, {
    billingMode: 'production',
    releaseTag,
  });
  assert.ok(responses.at(-1).includes('prerelease=false'));
  assert.ok(!responses.at(-1).some((argument) => argument.startsWith('body=')));
});

test('GitHub draft creation tolerates bounded release API read-after-create lag', async () => {
  const draft = sandboxDraft();
  const waits = [];
  let listReads = 0;
  let creates = 0;
  const api = (args) => {
    if (args[0] === `repos/StefanosCodes/GlideLingo/releases/tags/${releaseTag}`) {
      return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    }
    listReads += 1;
    return {
      status: 0,
      stdout: JSON.stringify(listReads < 3 ? [[]] : [[draft]]),
      stderr: '',
    };
  };
  const adapter = createGitHubAdapter(
    'StefanosCodes/GlideLingo',
    api,
    () => {
      creates += 1;
    },
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );

  assert.deepEqual(
    await adapter.createDraft(sandboxSelection()),
    draft,
  );
  assert.equal(creates, 1);
  assert.equal(listReads, 3);
  assert.deepEqual(waits, [2_000, 2_000]);
});

test('GitHub draft creation exhausts bounded lookup retries without recreating', async () => {
  let listReads = 0;
  let creates = 0;
  let waits = 0;
  const adapter = createGitHubAdapter(
    'StefanosCodes/GlideLingo',
    (args) => {
      if (args[0] === `repos/StefanosCodes/GlideLingo/releases/tags/${releaseTag}`) {
        return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
      }
      listReads += 1;
      return { status: 0, stdout: '[[]]', stderr: '' };
    },
    () => {
      creates += 1;
    },
    async () => {
      waits += 1;
    },
  );

  assert.equal(
    await adapter.createDraft({ billingMode: 'sandbox', commitSha, releaseTag }),
    null,
  );
  assert.equal(creates, 1);
  assert.equal(listReads, 10);
  assert.equal(waits, 9);
});

test('GitHub draft assets upload by immutable release id instead of tag lookup', async () => {
  const calls = [];
  const adapter = createGitHubAdapter('StefanosCodes/GlideLingo', (args) => {
    calls.push(args);
    return { status: 0, stdout: '{}', stderr: '' };
  });

  await adapter.uploadAssets(42, [
    '/tmp/GlideLingo 1.0.0.dmg',
    '/tmp/latest-mac.yml',
  ]);

  assert.deepEqual(calls, [
    [
      '--method',
      'POST',
      '--header',
      'Accept: application/vnd.github+json',
      '--header',
      'Content-Type: application/octet-stream',
      '--input',
      '/tmp/GlideLingo 1.0.0.dmg',
      'https://uploads.github.com/repos/StefanosCodes/GlideLingo/releases/42/assets?name=GlideLingo%201.0.0.dmg',
    ],
    [
      '--method',
      'POST',
      '--header',
      'Accept: application/vnd.github+json',
      '--header',
      'Content-Type: application/octet-stream',
      '--input',
      '/tmp/latest-mac.yml',
      'https://uploads.github.com/repos/StefanosCodes/GlideLingo/releases/42/assets?name=latest-mac.yml',
    ],
  ]);
});

function gitAdapter({ onMain = true, taggedCommit = commitSha } = {}) {
  return {
    resolveCommit(reference) {
      if (reference === 'refs/remotes/origin/main') return mainSha;
      if (reference === `refs/tags/${releaseTag}`) return taggedCommit;
      return commitSha;
    },
    readDesktopVersion() {
      return '1.0.0';
    },
    isAncestor(ancestor, descendant) {
      assert.equal(ancestor, commitSha);
      assert.equal(descendant, mainSha);
      return onMain;
    },
  };
}

function manualSelection(overrides = {}) {
  return {
    eventName: 'workflow_dispatch',
    manualCommit: commitSha,
    manualTag: releaseTag,
    version: '1.0.0',
    ...overrides,
  };
}

function createReleaseDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-release-'));
  const dmgName = 'GlideLingo-1.0.0-universal.dmg';
  const zipName = 'GlideLingo-1.0.0-universal.zip';
  const dmgPath = path.join(directory, dmgName);
  const zipPath = path.join(directory, zipName);
  fs.writeFileSync(dmgPath, 'dmg');
  fs.writeFileSync(path.join(directory, 'GlideLingo-1.0.0-universal.dmg.blockmap'), 'dmg-blockmap');
  fs.writeFileSync(zipPath, 'zip');
  fs.writeFileSync(path.join(directory, 'GlideLingo-1.0.0-universal.zip.blockmap'), 'zip-blockmap');
  const digest = (filePath) =>
    crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
  fs.writeFileSync(
    path.join(directory, 'latest-mac.yml'),
    [
      'version: 1.0.0',
      'files:',
      `  - url: ${zipName}`,
      `    sha512: ${digest(zipPath)}`,
      `    size: ${fs.statSync(zipPath).size}`,
      `  - url: ${dmgName}`,
      `    sha512: ${digest(dmgPath)}`,
      `    size: ${fs.statSync(dmgPath).size}`,
      `path: ${zipName}`,
      `sha512: ${digest(zipPath)}`,
      '',
    ].join('\n'),
  );
  writeChecksums(directory, '1.0.0');
  return directory;
}

function remoteAsset(asset, id) {
  return {
    id,
    name: asset.name,
    size: asset.size,
    state: 'uploaded',
    digest: `sha256:${asset.sha256}`,
  };
}

test('manual and tag releases resolve one exact protected main commit', () => {
  assert.deepEqual(resolveReleaseSelection(manualSelection(), gitAdapter()), {
    commitSha,
    releaseTag,
    version: '1.0.0',
  });
  assert.deepEqual(
    resolveReleaseSelection(
      {
        eventName: 'push',
        eventSha: commitSha,
        refName: releaseTag,
        refType: 'tag',
        version: '1.0.0',
      },
      gitAdapter(),
    ),
    { commitSha, releaseTag, version: '1.0.0' },
  );
});

test('release selection rejects off-main commits and moved tags', () => {
  assert.throws(
    () => resolveReleaseSelection(manualSelection(), gitAdapter({ onMain: false })),
    /not reachable.*origin\/main/,
  );
  assert.throws(
    () =>
      resolveReleaseSelection(
        manualSelection(),
        gitAdapter({ taggedCommit: 'c'.repeat(40) }),
      ),
    /does not point/,
  );
});

test('asset validation preserves the download contract and requires updater metadata', (context) => {
  const directory = createReleaseDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(expectedReleaseAssetNames('1.0.0'), [
    'GlideLingo-1.0.0-universal.dmg',
    'GlideLingo-1.0.0-universal.dmg.blockmap',
    'GlideLingo-1.0.0-universal.zip',
    'GlideLingo-1.0.0-universal.zip.blockmap',
    'latest-mac.yml',
    'SHA256SUMS.txt',
  ]);
  assert.equal(inspectLocalAssets(directory, '1.0.0').length, 6);

  fs.writeFileSync(path.join(directory, 'unexpected.zip'), 'unexpected');
  assert.throws(() => inspectLocalAssets(directory, '1.0.0'), /must be exactly/);
});

test('asset validation rejects partial and tampered release output', (context) => {
  const directory = createReleaseDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  fs.rmSync(path.join(directory, 'GlideLingo-1.0.0-universal.zip'));
  assert.throws(() => inspectLocalAssets(directory, '1.0.0'), /must be exactly/);

  fs.writeFileSync(path.join(directory, 'GlideLingo-1.0.0-universal.zip'), 'replacement');
  assert.throws(() => inspectLocalAssets(directory, '1.0.0'), /does not match/);

  writeChecksums(directory, '1.0.0');
  assert.throws(() => inspectLocalAssets(directory, '1.0.0'), /metadata does not match/);

  fs.writeFileSync(
    path.join(directory, 'latest-mac.yml'),
    'version: 1.0.1\nfiles:\n  - url: https://example.test/untrusted.zip\npath: untrusted.zip\n',
  );
  assert.throws(() => inspectLocalAssets(directory, '1.0.0'), /packaged desktop version/);
});

test('partial and rerun drafts converge by replacing every existing asset', async (context) => {
  const directory = createReleaseDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const localAssets = inspectLocalAssets(directory, '1.0.0');
  const calls = [];
  let release = sandboxDraft({
    id: 10,
    assets: [
      { id: 1, name: localAssets[0].name },
      { id: 2, name: localAssets[0].name },
      { id: 3, name: 'stale.zip' },
    ],
  });
  const github = {
    async getRelease() {
      return release;
    },
    async createDraft() {
      throw new Error('draft already exists');
    },
    async updateDraft(id) {
      calls.push(['update', id]);
    },
    async getReleaseById() {
      return release;
    },
    async deleteAsset(id) {
      calls.push(['delete', id]);
    },
    async uploadAssets(releaseId, paths) {
      calls.push(['upload', releaseId, paths.map((filePath) => path.basename(filePath))]);
      release = sandboxDraft({
        id: 10,
        assets: localAssets.map(remoteAsset),
      });
    },
  };

  await convergeDraftRelease(
    { billingMode: 'sandbox', commitSha, releaseTag, version: '1.0.0' },
    localAssets,
    github,
  );

  assert.deepEqual(calls.slice(0, 4), [
    ['update', 10],
    ['delete', 1],
    ['delete', 2],
    ['delete', 3],
  ]);
  assert.deepEqual(calls[4], [
    'upload',
    10,
    localAssets.map((asset) => asset.name),
  ]);

  calls.length = 0;
  await convergeDraftRelease(
    { billingMode: 'sandbox', commitSha, releaseTag, version: '1.0.0' },
    localAssets,
    github,
  );
  assert.equal(calls.filter(([action]) => action === 'delete').length, 6);
});

test('draft convergence refuses published releases and invalid remote asset sets', async () => {
  const localAssets = expectedReleaseAssetNames('1.0.0').map((name, index) => ({
    name,
    path: `/tmp/${name}`,
    size: index + 1,
    sha256: `${index}`.repeat(64),
  }));
  const published = {
    id: 1,
    tag_name: releaseTag,
    draft: false,
    assets: [],
  };
  await assert.rejects(
    convergeDraftRelease(
      { billingMode: 'preview', commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      {},
    ),
    /BILLING_MODE/,
  );
  await assert.rejects(
    convergeDraftRelease(
      { billingMode: 'production', commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      { async getRelease() { return published; } },
    ),
    /already published/,
  );

  let postCreateMutations = 0;
  await assert.rejects(
    convergeDraftRelease(
      { billingMode: 'production', commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      {
        async getRelease() { return null; },
        async createDraft() { return published; },
        async deleteAsset() { postCreateMutations += 1; },
        async uploadAssets() { postCreateMutations += 1; },
      },
    ),
    /exact unpublished draft identity/,
  );
  assert.equal(postCreateMutations, 0);

  postCreateMutations = 0;
  await assert.rejects(
    convergeDraftRelease(
      sandboxSelection(),
      localAssets,
      {
        async getRelease() { return null; },
        async createDraft() { return sandboxDraft({ id: 0 }); },
        async deleteAsset() { postCreateMutations += 1; },
        async uploadAssets() { postCreateMutations += 1; },
      },
    ),
    /exact unpublished draft identity/,
  );
  assert.equal(postCreateMutations, 0);

  const github = {
    async getRelease() {
      return null;
    },
    async getReleaseById() {
      return sandboxDraft({
        id: 2,
        assets: [remoteAsset(localAssets[0], 1)],
      });
    },
    async createDraft() {
      return sandboxDraft({ id: 2 });
    },
    async deleteAsset() {},
    async uploadAssets() {},
  };
  await assert.rejects(
    convergeDraftRelease(
      { billingMode: 'sandbox', commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      github,
    ),
    /must be exactly/,
  );

  await assert.rejects(
    convergeDraftRelease(
      { billingMode: 'sandbox', commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      {
        async getRelease() {
          return null;
        },
        async getReleaseById() {
          return sandboxDraft({
            id: 3,
            prerelease: false,
            assets: localAssets.map(remoteAsset),
          });
        },
        async createDraft() {
          return sandboxDraft({ id: 3 });
        },
        async deleteAsset() {},
        async uploadAssets() {},
      },
    ),
    /sandbox draft prerelease flag/,
  );
});

test('workflow uses protected WIF configuration and only pinned GCP secret versions', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../.github/workflows/desktop-release.yml'),
    'utf8',
  );
  const validationJob = workflow.split('\n  sign:')[0];
  assert.doesNotMatch(validationJob, /secrets\./);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /environment: desktop-release-signing/);
  assert.match(workflow, /id-token: write/);
  assert.match(
    workflow,
    /google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093/,
  );
  assert.match(
    workflow,
    /google-github-actions\/get-secretmanager-secrets@bc9c54b29fdffb8a47776820a7d26e77b379d262/,
  );
  assert.match(workflow, /workload_identity_provider: \$\{\{ vars\.GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER \}\}/);
  assert.match(workflow, /service_account: \$\{\{ vars\.GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT \}\}/);
  assert.match(workflow, /EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: \$\{\{ steps\.release_secrets\.outputs\.clerk_publishable_key \}\}/);
  assert.match(workflow, /EXPO_PUBLIC_REVENUECAT_WEB_API_KEY: \$\{\{ steps\.release_secrets\.outputs\.revenuecat_web_api_key \}\}/);
  assert.match(workflow, /GLIDELINGO_BILLING_MODE: \$\{\{ vars\.GLIDELINGO_BILLING_MODE \}\}/);
  assert.match(workflow, /GLIDELINGO_CLERK_ORIGIN: \$\{\{ vars\.GLIDELINGO_PRODUCTION_CLERK_ORIGIN \}\}/);
  assert.match(workflow, /macos_certificate_base64:\$\{\{ vars\.GLIDELINGO_MACOS_CERTIFICATE_SECRET_VERSION \}\}/);
  assert.match(workflow, /revenuecat_web_api_key:\$\{\{ vars\.GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION \}\}/);
  assert.doesNotMatch(workflow, /\$\{\{ secrets\./);
  assert.doesNotMatch(workflow, /credentials_json:/);
  assert.doesNotMatch(workflow, /versions\/latest/);
  assert.match(workflow, /release\/latest-mac\.yml/);
  assert.match(workflow, /release\/GlideLingo-\$\{\{ needs\.validate\.outputs\.version \}\}-universal\.zip\.blockmap/);
  assert.match(workflow, /release\/GlideLingo-\$\{\{ needs\.validate\.outputs\.version \}\}-universal\.dmg\.blockmap/);
  assert.match(workflow, /GLIDELINGO_RELEASE_VERSION: \$\{\{ needs\.validate\.outputs\.version \}\}/);
  assert.match(workflow, /ditto -x -k "release\/GlideLingo-\$\{GLIDELINGO_RELEASE_VERSION\}-universal\.zip"/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=2 "\$EXTRACTED_ZIP_APP\/GlideLingo\.app"/);
  assert.match(workflow, /spctl --assess --type execute --verbose=4 "\$EXTRACTED_ZIP_APP\/GlideLingo\.app"/);
  assert.match(workflow, /xcrun stapler validate "\$EXTRACTED_ZIP_APP\/GlideLingo\.app"/);
  assert.doesNotMatch(workflow, /gh release create[\s\S]*--latest/);
  assert.doesNotMatch(workflow, /PUBLIC_MAC_DOWNLOAD_STATE/);

  const gitignore = fs.readFileSync(path.resolve(__dirname, '../.gitignore'), 'utf8');
  assert.match(gitignore, /^gha-creds-\*\.json$/m);
});

test('builder pins the public GitHub update provider', () => {
  const builder = fs.readFileSync(
    path.resolve(__dirname, 'electron-builder.yml'),
    'utf8',
  );

  assert.match(builder, /publish:\n  provider: github\n  owner: StefanosCodes\n  repo: GlideLingo/);
  assert.doesNotMatch(builder, /private:\s*true/);
});
