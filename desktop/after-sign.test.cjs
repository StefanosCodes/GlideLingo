const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFinalCodesignArgs,
  buildNotarizeOptions,
  selectDeveloperIdIdentity,
} = require('./after-sign.cjs');

test('final signing selects exactly one Developer ID Application identity', () => {
  const output = `
  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: Stefanos Sophocleous (TEAM123456)"
     1 valid identities found
  `;

  assert.equal(
    selectDeveloperIdIdentity(output),
    'Developer ID Application: Stefanos Sophocleous (TEAM123456)',
  );
  assert.throws(() => selectDeveloperIdIdentity('0 valid identities found'), /exactly one/);
  assert.throws(
    () =>
      selectDeveloperIdIdentity(
        `${output}${output.replaceAll('Stefanos Sophocleous', 'Another Developer')}`,
      ),
    /exactly one/,
  );
});

test('final signing preserves Electron metadata and may target the CI keychain', () => {
  const args = buildFinalCodesignArgs(
    '/tmp/GlideLingo.app',
    'Developer ID Application: Stefanos Sophocleous (TEAM123456)',
    '/tmp/release.keychain',
  );

  assert.ok(!args.includes('--deep'));
  assert.ok(args.includes('--timestamp'));
  assert.ok(args.includes('--preserve-metadata=identifier,requirements,flags,entitlements'));
  assert.deepEqual(args.slice(-3), [
    '--keychain',
    '/tmp/release.keychain',
    '/tmp/GlideLingo.app',
  ]);
});

test('notarization options use the complete personal Apple credential set', () => {
  assert.deepEqual(
    buildNotarizeOptions('/tmp/GlideLingo.app', {
      APPLE_APP_SPECIFIC_PASSWORD: 'not-a-real-password',
      APPLE_ID: 'developer@example.com',
      APPLE_TEAM_ID: 'TEAM123456',
    }),
    {
      appPath: '/tmp/GlideLingo.app',
      appleId: 'developer@example.com',
      appleIdPassword: 'not-a-real-password',
      teamId: 'TEAM123456',
      tool: 'notarytool',
    },
  );
  assert.equal(buildNotarizeOptions('/tmp/GlideLingo.app', {}), null);
  assert.throws(
    () => buildNotarizeOptions('/tmp/GlideLingo.app', { APPLE_ID: 'developer@example.com' }),
    /Incomplete notarization credentials/,
  );
});
