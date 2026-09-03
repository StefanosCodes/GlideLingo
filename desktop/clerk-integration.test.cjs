const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.join(__dirname, '..');

test('desktop uses Clerk official Electron bridge end to end', () => {
  const rootPackage = require('../package.json');
  const desktopPackage = require('./package.json');
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  const providerSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/providers/clerk-provider.web.tsx'),
    'utf8',
  );
  const runtimeSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/providers/clerk-runtime.web.ts'),
    'utf8',
  );
  const signInRouteSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/app/(auth)/sign-in.web.tsx'),
    'utf8',
  );
  const signUpRouteSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/app/(auth)/sign-up.web.tsx'),
    'utf8',
  );
  const recoveryRouteSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/app/(auth)/forgot-password.web.tsx'),
    'utf8',
  );

  assert.equal(rootPackage.dependencies['@clerk/electron'], '0.0.36');
  assert.equal(desktopPackage.dependencies['@clerk/electron'], '0.0.36');
  assert.equal(desktopPackage.dependencies['electron-store'], '8.2.0');
  assert.match(mainSource, /createClerkBridge\(\{/);
  assert.match(mainSource, /renderer: \{ scheme: APP_SCHEME, host: 'app' \}/);
  assert.match(mainSource, /storage: createClerkStorage\(\{ name: 'clerk-tokens' \}\)/);
  assert.match(mainSource, /preload: path\.join\(__dirname, 'preload\.cjs'\)/);
  assert.doesNotMatch(mainSource, /!\s*DEVELOPMENT_URL\s*&&\s*\{\s*preload/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('__clerk_internal_electron'/);
  assert.match(preloadSource, /clerk:oauth-transport:open/);
  assert.doesNotMatch(preloadSource, /@clerk\/electron\/preload/);
  assert.match(providerSource, /@clerk\/electron\/react/);
  assert.match(providerSource, /@clerk\/react/);
  assert.match(providerSource, /shouldUseElectronClerkNativeAuth\(\)/);
  assert.match(providerSource, /routerPush=\{navigateWithExpoRouter\}/);
  assert.match(providerSource, /routerReplace=\{replaceWithExpoRouter\}/);
  assert.match(runtimeSource, /@clerk\/react/);
  assert.match(runtimeSource, /useSignIn/);
  assert.match(runtimeSource, /useSignUp/);
  assert.match(signInRouteSource, /signIn\.password/);
  assert.match(signInRouteSource, /signIn\.finalize/);
  assert.match(signInRouteSource, /Create an account/);
  assert.match(signInRouteSource, /Forgot your password/);
  assert.match(signUpRouteSource, /signUp\.password/);
  assert.match(signUpRouteSource, /sendEmailCode/);
  assert.match(signUpRouteSource, /verifyEmailCode/);
  assert.match(signUpRouteSource, /nativeID="clerk-captcha"/);
  assert.match(recoveryRouteSource, /resetPasswordEmailCode\.sendCode/);
  assert.match(recoveryRouteSource, /resetPasswordEmailCode\.verifyCode/);
  assert.match(recoveryRouteSource, /signOutOfOtherSessions: true/);
  assert.doesNotMatch(signInRouteSource, /Clerk:/);
  assert.doesNotMatch(signUpRouteSource, /Clerk:/);
  assert.doesNotMatch(recoveryRouteSource, /Clerk:/);
  assert.equal(fs.existsSync(path.join(__dirname, 'oauth-transport.cjs')), false);
});
