const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  DEVELOPMENT_CLERK_ORIGIN,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_CLERK_ORIGIN,
  PACKAGED_RENDERER_ORIGIN,
  buildContentSecurityPolicy,
  findAuthCallbackUrl,
  isAllowedAuthPopupNavigation,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isExactPackagedRendererUrl,
  isSafeExternalUrl,
  installAuthPopupNavigationSecurity,
  mapAuthCallbackToRendererUrl,
  parseAuthCallbackUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
  validateProductionApiOrigin,
  validateProductionClerkOrigin,
} = require('./runtime.cjs');

test('authentication popups are restricted to Clerk, Google, and Apple HTTPS origins', () => {
  assert.equal(isAllowedAuthWindowUrl('https://clerk.glidelingo.com/v1/oauth_callback'), true);
  assert.equal(isAllowedAuthWindowUrl('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(isAllowedAuthWindowUrl('https://appleid.apple.com/auth/authorize'), true);
  assert.equal(isAllowedAuthWindowUrl('https://clerk.accounts.dev.attacker.example/'), false);
  assert.equal(isAllowedAuthWindowUrl('https://another-instance.clerk.accounts.dev/'), false);
  assert.equal(isAllowedAuthWindowUrl('http://accounts.google.com/'), false);
  assert.equal(isAllowedAuthWindowUrl('javascript:alert(1)'), false);
});

test('development auth popup navigation stays on reviewed OAuth or renderer origins', () => {
  const rendererUrl = 'http://127.0.0.1:8081/';

  assert.equal(
    isAllowedAuthPopupNavigation(
      `${DEVELOPMENT_CLERK_ORIGIN}/v1/oauth_callback`,
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    true,
  );
  assert.equal(
    isAllowedAuthPopupNavigation(
      'https://accounts.google.com/o/oauth2/v2/auth',
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    true,
  );
  assert.equal(
    isAllowedAuthPopupNavigation(
      'https://appleid.apple.com/auth/authorize',
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    true,
  );
  assert.equal(
    isAllowedAuthPopupNavigation(
      'http://127.0.0.1:8081/sso-callback?state=opaque',
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    true,
  );
  assert.equal(
    isAllowedAuthPopupNavigation(
      'http://localhost:8081/sso-callback',
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    false,
  );
  assert.equal(
    isAllowedAuthPopupNavigation(
      'https://example.com/oauth',
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    false,
  );
  assert.equal(
    isAllowedAuthPopupNavigation('javascript:alert(1)', rendererUrl, DEVELOPMENT_CLERK_ORIGIN),
    false,
  );
  assert.equal(
    isAllowedAuthPopupNavigation(
      'https://clerk.glidelingo.com/v1/oauth_callback',
      rendererUrl,
      DEVELOPMENT_CLERK_ORIGIN,
    ),
    false,
  );
});

test('packaged CSP includes exact API and Clerk origins plus web checkout providers', () => {
  const policy = buildContentSecurityPolicy();

  assert.match(policy, new RegExp(PRODUCTION_API_ORIGIN.replaceAll('.', '\\.')));
  assert.match(policy, new RegExp(PRODUCTION_CLERK_ORIGIN.replaceAll('.', '\\.')));
  assert.match(policy, /https:\/\/js\.stripe\.com/);
  assert.match(policy, /https:\/\/cdn\.paddle\.com/);
  assert.doesNotMatch(policy, /\*\.clerk\.accounts\.dev/);
});

test('packaged CSP permits the pinned RevenueCat Web runtime resources by exact origin', () => {
  const policy = buildContentSecurityPolicy();
  const directives = new Map(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );

  assert.ok(directives.get('script-src').includes('https://sdk.revenuecat-static.com'));
  assert.ok(directives.get('img-src').includes('https://da08ctfrofx1b.cloudfront.net'));
  assert.ok(directives.get('font-src').includes('https://da08ctfrofx1b.cloudfront.net'));
  assert.ok(!directives.get('script-src').includes('https://*.revenuecat-static.com'));
  assert.ok(!directives.get('img-src').includes('https://*.cloudfront.net'));
  assert.ok(!directives.get('font-src').includes('https://*.cloudfront.net'));
});

test('auth popup navigation and redirect events enforce the same origin allowlist', () => {
  const listeners = new Map();
  const openedExternally = [];
  const webContents = {
    on(eventName, listener) {
      listeners.set(eventName, listener);
    },
  };
  installAuthPopupNavigationSecurity(webContents, {
    clerkOrigin: PRODUCTION_CLERK_ORIGIN,
    rendererUrl: 'http://127.0.0.1:8081/',
    openExternalUrl: (url) => openedExternally.push(url),
  });

  assert.deepEqual([...listeners.keys()], ['will-navigate', 'will-redirect']);

  for (const eventName of ['will-navigate', 'will-redirect']) {
    const allowedEvent = { prevented: false, preventDefault() { this.prevented = true; } };
    listeners.get(eventName)(allowedEvent, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(allowedEvent.prevented, false);

    const blockedEvent = { prevented: false, preventDefault() { this.prevented = true; } };
    listeners.get(eventName)(blockedEvent, 'https://example.com/unreviewed-auth');
    assert.equal(blockedEvent.prevented, true);
  }

  assert.deepEqual(openedExternally, [
    'https://example.com/unreviewed-auth',
    'https://example.com/unreviewed-auth',
  ]);
});

test('OS authentication callbacks require the exact app origin, route, and bounded parameters', () => {
  const valid = 'glidelingo://app/sign-in?__clerk_status=verified&state=opaque';
  const exactSignIn = encodeURIComponent('glidelingo://app/sign-in');
  const exactCallback = encodeURIComponent('glidelingo://app/sso-callback');

  assert.equal(parseAuthCallbackUrl(valid), valid);
  assert.equal(findAuthCallbackUrl(['/Applications/GlideLingo.app', valid]), valid);
  assert.equal(
    parseAuthCallbackUrl(
      `glidelingo://app/sign-in?after_sign_in_url=${exactSignIn}` +
        `&after_sign_up_url=${exactCallback}&redirect_url=${exactCallback}&state=opaque`,
    ),
    `glidelingo://app/sign-in?after_sign_in_url=${exactSignIn}` +
      `&after_sign_up_url=${exactCallback}&redirect_url=${exactCallback}&state=opaque`,
  );
  assert.equal(
    parseAuthCallbackUrl(
      `glidelingo://app/sign-in?redirect_url=${encodeURIComponent(exactSignIn)}&state=opaque`,
    ),
    `glidelingo://app/sign-in?redirect_url=${encodeURIComponent(exactSignIn)}&state=opaque`,
  );
  assert.equal(parseAuthCallbackUrl('glidelingo://other/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://app:123/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://user:pass@app/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://app/progress?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('https://app/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://app/sign-in?state=one&state=two'), null);
  assert.equal(parseAuthCallbackUrl(`glidelingo://app/sign-in?state=${'x'.repeat(3000)}`), null);
});

test('OS callbacks reject ambiguous or attacker-controlled Clerk redirect destinations', () => {
  const callback = 'glidelingo://app/sso-callback';
  const redirect = (name, destination) =>
    `${callback}?${name}=${encodeURIComponent(destination)}&state=opaque`;
  const redirectControls = [
    'sign_in_force_redirect_url',
    'sign_up_force_redirect_url',
    'sign_in_fallback_redirect_url',
    'sign_up_fallback_redirect_url',
    'after_sign_in_url',
    'after_sign_up_url',
    'redirect_url',
    'signInForceRedirectUrl',
    'signUpForceRedirectUrl',
    'signInFallbackRedirectUrl',
    'signUpFallbackRedirectUrl',
    'afterSignInUrl',
    'afterSignUpUrl',
    'redirectUrl',
  ];

  for (const name of redirectControls) {
    assert.equal(parseAuthCallbackUrl(redirect(name, 'glidelingo://other/sign-in')), null);
    assert.equal(parseAuthCallbackUrl(redirect(name, 'glidelingo://app/other')), null);
    assert.equal(parseAuthCallbackUrl(redirect(name, 'glidelingo://app/sign-in?next=evil')), null);
    assert.equal(parseAuthCallbackUrl(redirect(name, 'glidelingo://app/sign-in#evil')), null);
    assert.equal(
      parseAuthCallbackUrl(redirect(name, encodeURIComponent('glidelingo://other/sign-in'))),
      null,
    );
    assert.equal(
      parseAuthCallbackUrl(
        redirect(name, encodeURIComponent(encodeURIComponent('glidelingo://app/other'))),
      ),
      null,
    );
  }

  const exact = encodeURIComponent('glidelingo://app/sign-in');
  assert.equal(
    parseAuthCallbackUrl(
      `${callback}?redirect_url=${exact}&redirectUrl=${exact}&state=opaque`,
    ),
    null,
  );

  const provenExploit = encodeURIComponent('https://attacker.example/steal-session');
  assert.equal(
    parseAuthCallbackUrl(
      `${callback}?sign_in_force_redirect_url=${provenExploit}&state=opaque`,
    ),
    null,
  );
  assert.equal(
    parseAuthCallbackUrl(
      `${callback}#/complete?sign_in_force_redirect_url=${provenExploit}&state=opaque`,
    ),
    null,
  );
});

test('safe Clerk hash-router callback state is preserved after redirect validation', () => {
  const exact = encodeURIComponent('glidelingo://app/sso-callback');
  const callback =
    `glidelingo://app/sso-callback#/complete?sign_in_force_redirect_url=${exact}` +
    '&__clerk_status=verified&state=opaque';

  assert.equal(parseAuthCallbackUrl(callback), callback);
  assert.equal(
    mapAuthCallbackToRendererUrl(callback),
    `${PACKAGED_RENDERER_ORIGIN}/sso-callback` +
      `#/complete?sign_in_force_redirect_url=${exact}` +
      '&__clerk_status=verified&state=opaque',
  );
});

test('accepted OS callbacks translate to the exact packaged HTTPS renderer', () => {
  assert.equal(
    mapAuthCallbackToRendererUrl(
      'glidelingo://app/sso-callback?__clerk_status=verified&state=opaque',
    ),
    `${PACKAGED_RENDERER_ORIGIN}/sso-callback?__clerk_status=verified&state=opaque`,
  );
  assert.equal(mapAuthCallbackToRendererUrl('glidelingo://other/sso-callback?state=opaque'), null);
  assert.equal(
    mapAuthCallbackToRendererUrl(
      'glidelingo://app/sso-callback?state=opaque',
      'https://desktop.glidelingo.com.attacker.example',
    ),
    null,
  );
});

test('packaged renderer URLs require the exact virtual HTTPS origin', () => {
  assert.equal(isExactPackagedRendererUrl(`${PACKAGED_RENDERER_ORIGIN}/sign-in`), true);
  assert.equal(isExactPackagedRendererUrl('http://desktop.glidelingo.com/sign-in'), false);
  assert.equal(isExactPackagedRendererUrl('https://desktop.glidelingo.com:444/sign-in'), false);
  assert.equal(isExactPackagedRendererUrl('https://user:pass@desktop.glidelingo.com/sign-in'), false);
  assert.equal(isExactPackagedRendererUrl('https://desktop.glidelingo.com.attacker.example/sign-in'), false);
});

test('development renderer URL is restricted to the local Expo server', () => {
  assert.equal(validateDevelopmentUrl('http://127.0.0.1:8081'), 'http://127.0.0.1:8081/');
  assert.equal(validateDevelopmentUrl('http://localhost:8081'), 'http://localhost:8081/');
  assert.throws(() => validateDevelopmentUrl('https://example.com'));
  assert.throws(() => validateDevelopmentUrl('http://localhost:3000'));
  assert.throws(() => validateDevelopmentUrl('http://localhost:8081/unexpected'));
});

test('virtual HTTPS renderer maps routes and assets inside the exported web directory', () => {
  const root = path.resolve('/tmp/glidelingo-dist');

  assert.equal(resolveRendererPath(root, `${PACKAGED_RENDERER_ORIGIN}/`), path.join(root, 'index.html'));
  assert.equal(
    resolveRendererPath(root, `${PACKAGED_RENDERER_ORIGIN}/explore`),
    path.join(root, 'explore.html'),
  );
  assert.equal(
    resolveRendererPath(root, `${PACKAGED_RENDERER_ORIGIN}/_expo/static/app.js`),
    path.join(root, '_expo/static/app.js'),
  );
});

test('virtual HTTPS renderer rejects other hosts and traversal attempts', () => {
  const root = path.resolve('/tmp/glidelingo-dist');

  assert.equal(resolveRendererPath(root, 'https://other.glidelingo.com/index.html'), null);
  assert.equal(resolveRendererPath(root, 'https://desktop.glidelingo.com:444/index.html'), null);
  assert.equal(resolveRendererPath(root, 'https://user:pass@desktop.glidelingo.com/index.html'), null);
  assert.equal(resolveRendererPath(root, 'glidelingo://app/index.html'), null);
  assert.equal(resolveRendererPath(root, `${PACKAGED_RENDERER_ORIGIN}/%2e%2e/secret.txt`), null);
  assert.equal(resolveRendererPath(root, `${PACKAGED_RENDERER_ORIGIN}/%E0%A4%A`), null);
});

test('navigation stays in the renderer and only HTTPS links may open externally', () => {
  assert.equal(
    isAllowedNavigation(`${PACKAGED_RENDERER_ORIGIN}/explore`, `${PACKAGED_RENDERER_ORIGIN}/`),
    true,
  );
  assert.equal(
    isAllowedNavigation('https://other.glidelingo.com/explore', `${PACKAGED_RENDERER_ORIGIN}/`),
    false,
  );
  assert.equal(
    isAllowedNavigation('https://desktop.glidelingo.com:444/explore', `${PACKAGED_RENDERER_ORIGIN}/`),
    false,
  );
  assert.equal(
    isAllowedNavigation('https://user:pass@desktop.glidelingo.com/explore', `${PACKAGED_RENDERER_ORIGIN}/`),
    false,
  );
  assert.equal(
    isAllowedNavigation('http://127.0.0.1:8081/explore', 'http://127.0.0.1:8081/'),
    true,
  );
  assert.equal(
    isAllowedNavigation(
      `blob:${PACKAGED_RENDERER_ORIGIN}/adversarial-id`,
      `${PACKAGED_RENDERER_ORIGIN}/`,
    ),
    false,
  );
  assert.equal(
    isAllowedNavigation(
      `filesystem:${PACKAGED_RENDERER_ORIGIN}/temporary/adversarial.html`,
      `${PACKAGED_RENDERER_ORIGIN}/`,
    ),
    false,
  );
  assert.equal(isSafeExternalUrl('https://docs.expo.dev/'), true);
  assert.equal(isSafeExternalUrl('http://example.com/'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});

test('packaged API access is restricted to one exact HTTPS origin', () => {
  assert.equal(
    validateProductionApiOrigin('https://api.glidelingo.com'),
    'https://api.glidelingo.com',
  );
  assert.equal(
    validateProductionApiOrigin('https://api.glidelingo.com:8443'),
    'https://api.glidelingo.com:8443',
  );

  for (const value of [
    undefined,
    '',
    'http://api.glidelingo.com',
    'https://user@example.com',
    'https://api.glidelingo.com/v1',
    'https://api.glidelingo.com?debug=true',
    ' https://api.glidelingo.com',
  ]) {
    assert.throws(() => validateProductionApiOrigin(value));
  }
});

test('packaged Clerk access is restricted to one exact HTTPS origin', () => {
  assert.equal(
    validateProductionClerkOrigin('https://clerk.glidelingo.com'),
    'https://clerk.glidelingo.com',
  );
  for (const value of [
    undefined,
    '',
    'http://clerk.glidelingo.com',
    'https://user@clerk.glidelingo.com',
    'https://clerk.glidelingo.com/path',
  ]) {
    assert.throws(() => validateProductionClerkOrigin(value));
  }
});

test('packaged CSP permits only the configured API and Clerk origins', () => {
  const policy = buildContentSecurityPolicy({
    apiOrigin: 'https://api.release.glidelingo.com',
    clerkOrigin: 'https://clerk.release.glidelingo.com',
  });
  const connectDirective = policy
    .split('; ')
    .find((directive) => directive.startsWith('connect-src'));
  assert.match(connectDirective, /https:\/\/api\.release\.glidelingo\.com/);
  assert.match(connectDirective, /https:\/\/clerk\.release\.glidelingo\.com/);
  assert.doesNotMatch(policy, new RegExp(PRODUCTION_API_ORIGIN.replaceAll('.', '\\.')));
  assert.doesNotMatch(policy, new RegExp(PRODUCTION_CLERK_ORIGIN.replaceAll('.', '\\.')));
  assert.equal(
    isAllowedAuthWindowUrl(
      'https://clerk.glidelingo.com/v1/oauth_callback',
      'https://clerk.glidelingo.com',
    ),
    true,
  );
  assert.equal(
    isAllowedAuthWindowUrl(
      'https://vast-gator-9531.clerk.accounts.dev/v1/oauth_callback',
      'https://clerk.glidelingo.com',
    ),
    false,
  );
});
