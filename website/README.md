# GlideLingo website

This directory is the independently built, static marketing and macOS download site for GlideLingo. It does not share dependencies, runtime state, authentication, or deployment with the Expo, Electron, or FastAPI applications in the repository.

## Local development

Use Node 24 and npm from this directory:

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

Preview builds intentionally show `Mac release coming soon` when release variables are absent.

## Release configuration

Cloudflare Pages uses one build command, `npm run build`, for both supported production states. Set `PUBLIC_MAC_DOWNLOAD_STATE=disabled` to publish the explicit `Mac release coming soon` state. Set it to `active` only after a signed and notarized GitHub Release has passed its clean-Mac smoke test.

| Variable | Value |
| --- | --- |
| `PUBLIC_MAC_DOWNLOAD_STATE` | Required on `main`: exactly `disabled` or `active` |
| `PUBLIC_MAC_DOWNLOAD_URL` | For `active`: exact HTTPS URL of `GlideLingo-{version}-universal.dmg` in the `desktop-v{version}` GitHub Release |
| `PUBLIC_MAC_CHECKSUM_URL` | For `active`: exact HTTPS URL of `SHA256SUMS.txt` in that same GitHub Release |
| `PUBLIC_MAC_VERSION` | Semantic version displayed on the page, such as `0.1.0` |
| `PUBLIC_MAC_RELEASE_DATE` | UTC calendar date in `YYYY-MM-DD` form |

The build fails closed when the production state is absent or invalid, release metadata is partial, or the version, release tag, DMG filename, and checksum manifest do not identify the same release. A complete valid release configuration may remain present while the state is `disabled`; this is the rollback path and the generated site contains no release links. Pull-request previews with no state or metadata remain safely non-downloadable. Values are public metadata and must never contain credentials.

## Cloudflare Pages

Create one Pages project with Git integration:

- Repository: `StefanosCodes/GlideLingo`
- Production branch: `main`
- Root directory: `website`
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `24`
- Preview deployments: enabled for pull requests
- Production custom domain: `glidelingo.com`

Attach `www.glidelingo.com` to the Pages project as well, then create a Cloudflare zone-level redirect because Pages `_redirects` files do not support redirects between hostnames:

- Match expression: `(http.host eq "www.glidelingo.com")`
- Dynamic target: `concat("https://glidelingo.com", http.request.uri.path)`
- Status code: `301`
- Preserve query string: enabled

Use either Cloudflare's **Redirect from WWW to root** Single Redirect template or the equivalent Bulk Redirect configuration. Keep both hostnames proxied so the redirect rule can run. This is a required external production gate because Pages cannot represent a cross-host redirect in a `_redirects` file. After activation, verify a non-root path and query:

```sh
curl --silent --show-error --dump-header - --output /dev/null 'https://www.glidelingo.com/redirect-check?source=cloudflare'
```

The response must be `301` with `Location: https://glidelingo.com/redirect-check?source=cloudflare`. The committed `_headers` file applies the site security policy.

Do not configure production release variables until the exact DMG has been signed, notarized, downloaded on a clean Mac, checksum-verified, installed, launched, and exercised through lesson completion and restart persistence.

## Verification

```sh
npm run check
npm test
npm run build:fixture:disabled
npm run test:e2e
npm run build:fixture:rollback
```

The disabled fixture proves the documented production build works before launch. `npm run test:e2e` uses the same `npm run build` entry point with fixed, non-live release fixture URLs and verifies active-download rendering in Chromium at mobile, tablet, and desktop widths plus WebKit at desktop width. The rollback fixture rebuilds the same valid active metadata with only the state changed to `disabled`, then verifies that no release link is emitted. These checks never download the fixture assets.

## Visual evidence

The committed captures show the safe `Coming soon` preview state used before a notarized release is configured:

- [Desktop landing page](docs/landing-preview-desktop.png)
- [Mobile landing page](docs/landing-preview-mobile.png)
