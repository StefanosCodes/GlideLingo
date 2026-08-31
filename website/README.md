# GlideLingo website

This directory is the independently built, static marketing and macOS download site for GlideLingo. It does not share dependencies, runtime state, authentication, or deployment with the Expo, Electron, or FastAPI applications in the repository.

## Local development

Use Node 24 and npm from this directory:

```sh
npm ci
npm run dev
```

Preview builds intentionally show `Mac release coming soon` when release variables are absent.

## Release configuration

Cloudflare Pages injects these public build variables after a signed and notarized GitHub Release has passed its clean-Mac smoke test:

| Variable | Value |
| --- | --- |
| `PUBLIC_MAC_DOWNLOAD_URL` | Exact HTTPS URL of the versioned `.dmg` asset in `StefanosCodes/GlideLingo` GitHub Releases |
| `PUBLIC_MAC_CHECKSUM_URL` | Exact HTTPS URL of the matching `.sha256` or `.txt` checksum asset |
| `PUBLIC_MAC_VERSION` | Semantic version displayed on the page, such as `0.1.0` |
| `PUBLIC_MAC_RELEASE_DATE` | UTC calendar date in `YYYY-MM-DD` form |

When `CF_PAGES_BRANCH=main`, the build fails if a value is missing or invalid. Pull-request previews without values remain safely non-downloadable. Values are public metadata and must never contain credentials.

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

Use either Cloudflare's **Redirect from WWW to root** Single Redirect template or the equivalent Bulk Redirect configuration. Keep both hostnames proxied so the redirect rule can run. Verify the live redirect after activation; this setting lives in Cloudflare and is not represented by a Pages `_redirects` file. The committed `_headers` file applies the site security policy.

Do not configure production release variables until the exact DMG has been signed, notarized, downloaded on a clean Mac, checksum-verified, installed, launched, and exercised through lesson completion and restart persistence.

## Verification

```sh
npm run check
npm test
npm run build
npm run test:e2e
```

`npm run build` validates the non-downloadable preview state. `npm run test:e2e` builds with fixed, non-live release fixture URLs and verifies the active-download rendering at mobile, tablet, and desktop widths. It never downloads the fixture asset.

## Visual evidence

The committed captures show the safe `Coming soon` preview state used before a notarized release is configured:

- [Desktop landing page](docs/landing-preview-desktop.png)
- [Mobile landing page](docs/landing-preview-mobile.png)
