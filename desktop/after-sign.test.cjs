const assert = require('node:assert/strict');
const test = require('node:test');

const { buildNotarizeOptions } = require('./after-sign.cjs');

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
