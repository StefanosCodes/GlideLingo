const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { expectedReleaseAssetNames } = require('./release-workflow.cjs');
const {
  createGitHubAcceptanceClient,
  findDraftCandidatePages,
  prepareAcceptanceDirectory,
  resolveReleaseSelection,
  runDraftAcceptance,
  validateDraftRelease,
  validateRemoteAssets,
  verifyDownloadedArtifacts,
  verifyMacBundle,
} = require('./release-acceptance.cjs');

const releaseTag = 'desktop-v1.0.7';
const commitSha = 'a'.repeat(40);

function releaseAssets() {
  return expectedReleaseAssetNames('1.0.7').map((name, index) => ({
    digest: `sha256:${String(index).padStart(64, '0')}`,
    id: index + 1,
    name,
    size: index + 10,
    state: 'uploaded',
  }));
}

function draft(overrides = {}) {
  return {
    assets: releaseAssets(),
    draft: true,
    id: 42,
    name: `GlideLingo ${releaseTag} (internal sandbox)`,
    prerelease: true,
    tag_name: releaseTag,
    target_commitish: commitSha,
    ...overrides,
  };
}

test('draft recovery recognizes one matching internally untagged draft', () => {
  const candidate = draft({ tag_name: 'untagged-deadbeef' });
  assert.equal(
    findDraftCandidatePages([[{ draft: false }], [candidate]], {
      commitSha,
      releaseTag,
    }),
    candidate,
  );
  assert.throws(
    () => findDraftCandidatePages([[candidate, { ...candidate }]], { commitSha, releaseTag }),
    /Multiple GitHub drafts/,
  );
});

test('GitHub draft lookup paginates and re-reads the result by immutable release id', () => {
  const calls = [];
  const candidate = draft({ tag_name: 'untagged-deadbeef' });
  const client = createGitHubAcceptanceClient({
    commandRunner: (_command, args) => {
      calls.push(args);
      if (args[1]?.includes('/releases/tags/')) {
        return { status: 1, stdout: '', stderr: 'HTTP 404: Not Found' };
      }
      if (args.includes('--paginate')) {
        return { status: 0, stdout: JSON.stringify([[{ draft: false }], [candidate]]), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(candidate), stderr: '' };
    },
  });

  assert.deepEqual(client.inspectDraft({ commitSha, releaseTag }), candidate);
  assert.ok(calls.some((args) => args.includes('--paginate')));
  assert.deepEqual(calls.at(-1), [
    'api',
    'repos/StefanosCodes/GlideLingo/releases/42',
  ]);
});

test('draft acceptance rejects published, mismatched, partial, and incomplete releases', () => {
  const selection = { commitSha, releaseTag, version: '1.0.7' };
  assert.equal(validateDraftRelease(draft(), selection).billingMode, 'sandbox');
  assert.equal(
    validateDraftRelease(
      draft({ name: `GlideLingo ${releaseTag}`, prerelease: false }),
      selection,
    ).billingMode,
    'production',
  );
  assert.throws(() => validateDraftRelease(draft({ draft: false }), selection), /already published/);
  assert.throws(
    () => validateDraftRelease(draft({ target_commitish: 'b'.repeat(40) }), selection),
    /tagged commit/,
  );
  assert.throws(
    () => validateDraftRelease(draft({ assets: releaseAssets().slice(1) }), selection),
    /exact six/,
  );
  assert.throws(
    () => validateDraftRelease(draft({ assets: releaseAssets().map((asset, index) => index ? asset : { ...asset, digest: null }) }), selection),
    /incomplete/,
  );
});

test('release selection binds the protected tag, main ancestry, and both version manifests', () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${commitSha}\n` };
    if (args[0] === 'merge-base') return { status: 0, stdout: '' };
    if (args[0] === 'show') return { status: 0, stdout: '{"version":"1.0.7"}' };
    return { status: 0, stdout: '' };
  };
  assert.deepEqual(resolveReleaseSelection(releaseTag, runner), {
    commitSha,
    releaseTag,
    version: '1.0.7',
  });
  assert.ok(calls.some(([, args]) => args[0] === 'fetch'));
  assert.throws(() => resolveReleaseSelection('../bad', runner), /strict release tag/);
});

test('acceptance output directory is isolated and rejects symlinked roots', (context) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-acceptance-'));
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const destination = prepareAcceptanceDirectory(releaseTag, { projectRoot });
  fs.writeFileSync(path.join(destination, 'stale'), 'old');
  assert.equal(prepareAcceptanceDirectory(releaseTag, { projectRoot }), destination);
  assert.deepEqual(fs.readdirSync(destination), []);

  fs.rmSync(path.join(projectRoot, 'release-acceptance'), { recursive: true });
  fs.symlinkSync(projectRoot, path.join(projectRoot, 'release-acceptance'));
  assert.throws(
    () => prepareAcceptanceDirectory(releaseTag, { projectRoot }),
    /must not be a symbolic link/,
  );
});

test('downloaded assets must match GitHub sizes and digests', () => {
  const contents = Buffer.from('artifact');
  const digest = crypto.createHash('sha256').update(contents).digest('hex');
  const local = [{ name: 'GlideLingo.dmg', size: contents.length, sha256: digest }];
  assert.doesNotThrow(() => validateRemoteAssets([
    { name: 'GlideLingo.dmg', size: contents.length, digest: `sha256:${digest}` },
  ], local));
  assert.throws(() => validateRemoteAssets([
    { name: 'GlideLingo.dmg', size: contents.length + 1, digest: `sha256:${digest}` },
  ], local), /does not match GitHub/);
});

test('DMG is detached and temporary verification files are removed when validation fails', () => {
  const commands = [];
  let verificationCount = 0;
  assert.throws(
    () => verifyDownloadedArtifacts('/tmp/release', '1.0.7', {
      commandRunner: (command, args) => {
        commands.push([command, args]);
        return { status: 0, stdout: '' };
      },
      verifyBundle: () => {
        verificationCount += 1;
        if (verificationCount === 2) throw new Error('signature failed');
      },
    }),
    /signature failed/,
  );
  assert.ok(commands.some(([command, args]) => command === 'hdiutil' && args[0] === 'detach'));
  const mount = commands.find(([command, args]) => command === 'hdiutil' && args[0] === 'attach')[1][4];
  assert.equal(fs.existsSync(path.dirname(mount)), false);
});

test('downloaded apps require Developer ID identity, notarization, version, and universal slices', () => {
  const runner = (command, args) => {
    if (command === 'codesign' && args[0] === '--display') {
      return {
        status: 0,
        stdout: '',
        stderr: 'Authority=Developer ID Application: GlideLingo LLC (ABC123XYZ9)\nTeamIdentifier=ABC123XYZ9\n',
      };
    }
    if (command === '/usr/libexec/PlistBuddy') return { status: 0, stdout: '1.0.7\n' };
    if (command === 'lipo') return { status: 0, stdout: 'x86_64 arm64\n' };
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.doesNotThrow(() => verifyMacBundle('/tmp/GlideLingo.app', '1.0.7', runner));

  assert.throws(
    () => verifyMacBundle('/tmp/GlideLingo.app', '1.0.7', (command, args) => {
      if (command === 'codesign' && args[0] === '--display') {
        return { status: 0, stdout: '', stderr: 'Signature=adhoc\nTeamIdentifier=not set\n' };
      }
      return runner(command, args);
    }),
    /Developer ID Application identity/,
  );
  assert.throws(
    () => verifyMacBundle('/tmp/GlideLingo.app', '1.0.7', (command, args) => {
      if (command === 'lipo') return { status: 0, stdout: 'arm64\n' };
      return runner(command, args);
    }),
    /both x86_64 and arm64/,
  );
});

test('draft acceptance downloads exact assets without publishing or installing', (context) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-acceptance-'));
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, 'desktop'));
  fs.writeFileSync(path.join(projectRoot, 'desktop/package.json'), '{"version":"1.0.7"}');
  const remoteAssets = releaseAssets();
  const logs = [];
  const result = runDraftAcceptance(releaseTag, {
    commandRunner: () => ({ status: 0, stdout: '' }),
    createClient: () => ({
      downloadAsset: (asset, outputPath) => fs.writeFileSync(outputPath, asset.name),
      inspectDraft: () => draft({ assets: remoteAssets }),
    }),
    inspectAssets: (_directory, _version) => remoteAssets.map((asset) => ({
      name: asset.name,
      sha256: asset.digest.slice('sha256:'.length),
      size: asset.size,
    })),
    logger: { log: (message) => logs.push(message) },
    platform: 'darwin',
    projectRoot,
    resolveSelection: () => ({ commitSha, releaseTag, version: '1.0.7' }),
    verifyArtifacts: () => {},
  });
  assert.equal(result.localAssets.length, 6);
  assert.ok(logs.some((message) => message.includes('Nothing was published')));
});

test('download failures are redacted and leave publication untouched', (context) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-acceptance-'));
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, 'desktop'));
  fs.writeFileSync(path.join(projectRoot, 'desktop/package.json'), '{"version":"1.0.7"}');
  assert.throws(
    () => runDraftAcceptance(releaseTag, {
      commandRunner: () => ({ status: 0, stdout: '' }),
      createClient: () => ({
        downloadAsset: () => { throw new Error('token=private-value'); },
        inspectDraft: () => draft(),
      }),
      platform: 'darwin',
      projectRoot,
      resolveSelection: () => ({ commitSha, releaseTag, version: '1.0.7' }),
    }),
    (error) => /Could not download release asset/.test(error.message) && !/private-value/.test(error.message),
  );
});
