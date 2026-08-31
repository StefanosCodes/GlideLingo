# GlideLingo website

This directory is the independently built, static marketing site for GlideLingo. It does not share dependencies, runtime state, authentication, or deployment with the Expo, Electron, or FastAPI applications in the repository.

## Brand assets

The website self-hosts the Satoshi variable display font and composes its typographic lockup with the approved monochrome GlideLingo bird SVG. Satoshi is distributed by Fontshare under the ITF Free Font License preserved at `licenses/Satoshi-ITF-FFL.txt`. Inter remains the body and interface typeface. Production pages make no third-party font requests.

The How-it-works section is a native, 16:9 video player that plays a muted, looping first-party walkthrough when it enters the viewport and uses the current application screenshot as its poster. It pauses offscreen and respects `prefers-reduced-motion`. Replace `public/videos/glidelingo-product-walkthrough.mp4`, its WebM companion, and the English caption file at `public/videos/glidelingo-product-walkthrough.vtt` together when the final screen recording is ready; no page code needs to change. If any asset is absent, the page safely displays `Video coming soon` without requesting missing media. It must not be replaced with a third-party embed. The landing page has no desktop-apps section; it retains only the Mac hero CTA.

## Local development

Use Node 24 and npm from this directory:

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

## Mac hero CTA

The Apple `Download for Mac` button always remains visible. Without release metadata it is safely disabled. Set `PUBLIC_MAC_DOWNLOAD_STATE=active` together with `PUBLIC_MAC_DOWNLOAD_URL`, `PUBLIC_MAC_CHECKSUM_URL`, `PUBLIC_MAC_VERSION`, and `PUBLIC_MAC_RELEASE_DATE` only after the signed and notarized release is ready. The existing release resolver validates that all metadata identifies the same GitHub Release before emitting the DMG link.

## Blog

The blog is a static Astro content collection. Add a Markdown file to `src/data/blog` with these frontmatter fields: `title`, `description`, `publishedAt`, `category`, `readMinutes`, `heroImage`, `heroAlt`, and `draft`. Categories are intentionally limited to `Learning`, `Product`, and `Company`; update the schema in `src/content.config.mjs` when the editorial taxonomy genuinely expands.

Published entries automatically appear newest-first on `/blog/` and receive a static route at `/blog/<filename>/`. Set `draft: true` to keep an entry out of both the index and generated routes. Store editorial images under `public/images/blog` so production pages remain first-party and independent of a remote image service.

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

## Verification

```sh
npm run check
npm test
npm run build:fixture:disabled
npm run test:e2e
npm run build:fixture:rollback
```

The production-state fixtures verify both the linked and safely disabled hero CTA. The browser suite covers Chromium at mobile, tablet, and desktop widths plus WebKit at desktop width. These checks never download fixture assets.
