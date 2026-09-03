const path = require('node:path');
const { execFileSync } = require('node:child_process');

function completeCredentialGroup(environment, names) {
  const present = names.filter((name) => Boolean(environment[name]));

  if (present.length > 0 && present.length < names.length) {
    const missing = names.filter((name) => !environment[name]);
    throw new Error(`Incomplete notarization credentials; missing ${missing.join(', ')}.`);
  }

  return present.length === names.length;
}

function buildNotarizeOptions(appPath, environment = process.env) {
  if (
    completeCredentialGroup(environment, [
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ])
  ) {
    return {
      appPath,
      appleId: environment.APPLE_ID,
      appleIdPassword: environment.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: environment.APPLE_TEAM_ID,
      tool: 'notarytool',
    };
  }

  if (
    completeCredentialGroup(environment, [
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ])
  ) {
    return {
      appPath,
      appleApiIssuer: environment.APPLE_API_ISSUER,
      appleApiKey: environment.APPLE_API_KEY,
      appleApiKeyId: environment.APPLE_API_KEY_ID,
      tool: 'notarytool',
    };
  }

  if (environment.APPLE_KEYCHAIN_PROFILE) {
    return {
      appPath,
      keychain: environment.APPLE_KEYCHAIN || undefined,
      keychainProfile: environment.APPLE_KEYCHAIN_PROFILE,
      tool: 'notarytool',
    };
  }

  return null;
}

function verifySignature(appPath) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
}

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  console.log('[desktop-release] Verifying electron-builder signature before notarization.');
  verifySignature(appPath);

  const notarizeOptions = buildNotarizeOptions(appPath);
  if (!notarizeOptions) {
    console.log('[desktop-release] Notarization credentials absent; local package only.');
    return;
  }

  console.log('[desktop-release] Submitting verified app to Apple notarization.');
  const { notarize } = require('@electron/notarize');
  await notarize(notarizeOptions);
  console.log('[desktop-release] Apple notarization and stapling completed.');
}

module.exports = afterSign;
module.exports.buildNotarizeOptions = buildNotarizeOptions;
