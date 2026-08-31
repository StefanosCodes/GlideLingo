const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  convergeDraftRelease,
  expectedReleaseAssetNames,
  inspectLocalAssets,
  resolveReleaseSelection,
  writeChecksums,
} = require('./release-workflow.cjs');

const commitSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);
const releaseTag = 'desktop-v1.0.0';

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
  fs.writeFileSync(path.join(directory, 'GlideLingo-1.0.0-universal.dmg'), 'dmg');
  fs.writeFileSync(path.join(directory, 'GlideLingo-1.0.0-universal.zip'), 'zip');
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

test('asset validation preserves the exact PR 10 DMG and checksum names', (context) => {
  const directory = createReleaseDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(expectedReleaseAssetNames('1.0.0'), [
    'GlideLingo-1.0.0-universal.dmg',
    'GlideLingo-1.0.0-universal.zip',
    'SHA256SUMS.txt',
  ]);
  assert.equal(inspectLocalAssets(directory, '1.0.0').length, 3);

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
});

test('partial and rerun drafts converge by replacing every existing asset', async (context) => {
  const directory = createReleaseDirectory();
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const localAssets = inspectLocalAssets(directory, '1.0.0');
  const calls = [];
  let release = {
    id: 10,
    tag_name: releaseTag,
    draft: true,
    assets: [
      { id: 1, name: localAssets[0].name },
      { id: 2, name: localAssets[0].name },
      { id: 3, name: 'stale.zip' },
    ],
  };
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
    async deleteAsset(id) {
      calls.push(['delete', id]);
    },
    async uploadAssets(tag, paths) {
      calls.push(['upload', tag, paths.map((filePath) => path.basename(filePath))]);
      release = {
        id: 10,
        tag_name: releaseTag,
        draft: true,
        assets: localAssets.map(remoteAsset),
      };
    },
  };

  await convergeDraftRelease(
    { commitSha, releaseTag, version: '1.0.0' },
    localAssets,
    github,
  );

  assert.deepEqual(calls.slice(0, 4), [
    ['update', 10],
    ['delete', 1],
    ['delete', 2],
    ['delete', 3],
  ]);
  assert.deepEqual(calls[4][0], 'upload');

  calls.length = 0;
  await convergeDraftRelease(
    { commitSha, releaseTag, version: '1.0.0' },
    localAssets,
    github,
  );
  assert.equal(calls.filter(([action]) => action === 'delete').length, 3);
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
      { commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      { async getRelease() { return published; } },
    ),
    /already published/,
  );

  let reads = 0;
  const github = {
    async getRelease() {
      reads += 1;
      if (reads === 1) return null;
      return {
        id: 2,
        tag_name: releaseTag,
        draft: true,
        assets: [remoteAsset(localAssets[0], 1)],
      };
    },
    async createDraft() {
      return { id: 2, tag_name: releaseTag, draft: true, assets: [] };
    },
    async deleteAsset() {},
    async uploadAssets() {},
  };
  await assert.rejects(
    convergeDraftRelease(
      { commitSha, releaseTag, version: '1.0.0' },
      localAssets,
      github,
    ),
    /must be exactly/,
  );
});

test('workflow keeps all Apple credentials out of preflight validation', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../.github/workflows/desktop-release.yml'),
    'utf8',
  );
  const validationJob = workflow.split('\n  sign:')[0];
  assert.doesNotMatch(validationJob, /secrets\./);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /environment: desktop-release-signing/);
  assert.doesNotMatch(workflow, /gh release create[\s\S]*--latest/);
});
