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
  const componentsSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/providers/clerk-components.web.tsx'),
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
  assert.match(runtimeSource, /@clerk\/react/);
  assert.match(componentsSource, /ElectronSignIn/);
  assert.match(componentsSource, /ReactSignIn/);
  assert.equal(fs.existsSync(path.join(__dirname, 'oauth-transport.cjs')), false);
});
