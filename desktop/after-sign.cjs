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

function selectDeveloperIdIdentity(securityOutput) {
  const identities = [
    ...securityOutput.matchAll(/^[ \t]*\d+\)[ \t]+[A-F0-9]{40}[ \t]+"(Developer ID Application:[^"]+)"/gim),
  ].map((match) => match[1]);
  const uniqueIdentities = [...new Set(identities)];

  if (uniqueIdentities.length !== 1) {
    throw new Error(
      `Expected exactly one Developer ID Application identity, found ${uniqueIdentities.length}.`,
    );
  }

  return uniqueIdentities[0];
}

function buildFinalCodesignArgs(appPath, identity, keychainFile) {
  const args = [
    '--force',
    '--deep',
    '--timestamp',
    '--preserve-metadata=identifier,requirements,flags,entitlements',
    '--sign',
    identity,
  ];

  if (keychainFile) {
    args.push('--keychain', keychainFile);
  }

  args.push(appPath);
  return args;
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
  const signingInfo = await context.packager.codeSigningInfo.value;
  const identityArguments = ['find-identity', '-v', '-p', 'codesigning'];

  if (signingInfo?.keychainFile) {
    identityArguments.push(signingInfo.keychainFile);
  }

  const identity = selectDeveloperIdIdentity(
    execFileSync('/usr/bin/security', identityArguments, { encoding: 'utf8' }),
  );

  console.log('[desktop-release] Applying final universal-bundle signature.');
  execFileSync(
    '/usr/bin/codesign',
    buildFinalCodesignArgs(appPath, identity, signingInfo?.keychainFile),
    { stdio: 'inherit' },
  );
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
module.exports.buildFinalCodesignArgs = buildFinalCodesignArgs;
module.exports.buildNotarizeOptions = buildNotarizeOptions;
module.exports.selectDeveloperIdIdentity = selectDeveloperIdIdentity;
