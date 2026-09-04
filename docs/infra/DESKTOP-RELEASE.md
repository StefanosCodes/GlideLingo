# Desktop release operations

## What this release lane produces

GlideLingo's first desktop channel is a direct macOS download, not the Mac App Store. One release produces:

- a universal DMG for users;
- a universal ZIP for release/update infrastructure;
- macOS update metadata and DMG/ZIP blockmaps for installed clients;
- SHA-256 checksums;
- a signed and notarized `GlideLingo.app` containing both x64 and arm64 code.

Expo exports the shared web renderer. Electron packages that renderer and restricts packaged API and Clerk requests to the exact origins validated from the release environment and embedded in the package metadata. `npm run desktop:release` fails before packaging when the production API, Clerk, RevenueCat Web, or notarization configuration is missing, and electron-builder fails when it cannot produce a real Developer ID signature.

The post-sign hook applies a final metadata-preserving signature to the combined universal bundle, verifies it, and only then invokes Apple's notarization service and staples the returned ticket. This preserves Electron's per-process entitlements while preventing an invalid universal signature from reaching Apple.

## One-time Apple setup

Use the personal **Stefanos Sophocleous** Apple Developer team that owns GlideLingo. Do not use Startem LLC or a development, Apple Distribution, Mac App Distribution, or Developer ID Installer certificate for this direct-download application.

1. In Keychain Access, choose **Certificate Assistant → Request a Certificate From a Certificate Authority**.
2. Enter the Apple Account email and a descriptive common name, select **Saved to disk**, and save the CSR.
3. In Apple Developer **Certificates, Identifiers & Profiles**, create a **Developer ID Application** certificate using the G2 intermediary and upload the CSR.
4. Download and open the issued `.cer` file so the certificate is paired with its private key in the login keychain.
5. In Keychain Access under **My Certificates**, export the Developer ID certificate and private key as a password-protected `.p12` file.
6. At [account.apple.com](https://account.apple.com/), create an app-specific password named `GlideLingo notarization`. Use the personal Stefanos Sophocleous Apple Account, not a Startem LLC App Store Connect provider.

The `.p12`, its password, the app-specific password, and their encoded contents are secrets. Never commit them, add them to an Expo public variable, paste them into logs, or attach them to a pull request.

## GitHub and GCP configuration

Create a protected GitHub Actions environment named exactly `desktop-release-signing` before
enabling this workflow. Configure at least one required reviewer who is not the person starting
the run, disallow administrators from bypassing the approval, and limit deployments to the
protected `main` branch and protected `desktop-v*` tags. The signing job is deliberately bound
to this environment; a repository without these protections is not release-ready.

Create a tag ruleset for `desktop-v*` that restricts tag creation, update, and deletion to the
release maintainers. A release tag must already exist, match `desktop/package.json`, and point to
an exact commit in the complete `main` history. The workflow enforces the commit/tag ancestry
again before any credential-bearing build step, but the ruleset is still required to prevent a
time-of-check/time-of-use tag change.

GitHub holds no Apple, Clerk-key, RevenueCat-key, service-account JSON, or other long-lived release
secret. The signing job obtains a short-lived GCP identity through Workload Identity Federation and
reads exact Secret Manager versions after environment approval. Grant its dedicated release service
account `roles/secretmanager.secretAccessor` only on the seven release secret containers.

Configure these non-secret environment variables on `desktop-release-signing`:

| Name | Value |
| --- | --- |
| `GLIDELINGO_GCP_PROJECT_ID` | Isolated production project ID, currently `glidelingo-prod-50843312405` |
| `GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER` | Full production release WIF provider resource name |
| `GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT` | Dedicated production desktop-release service account |
| `GLIDELINGO_PRODUCTION_API_ORIGIN` | Public HTTPS FastAPI base URL used by the production client |
| `GLIDELINGO_PRODUCTION_CLERK_ORIGIN` | Exact HTTPS Clerk frontend origin allowed by the packaged shell |
| `GLIDELINGO_BILLING_MODE` | Exactly `sandbox` for internal prelaunch drafts or `production` for a live candidate |

The release validator reads
`infra/gcp/environments/production/identity.json`, the same committed identity contract consumed
by production Terraform. The project ID, release service-account email, numeric project number,
WIF pool, and WIF provider must exactly match that manifest; production-looking prefixes are not
accepted. The manifest deliberately keeps `project_number` null until the production project
exists, which disables release authentication. After bootstrap, copy Terraform's resolved
`production_contract.project_number` into the manifest through a reviewed PR before configuring
these GitHub variables. The fallback project is not implicitly accepted; changing the production
identity requires changing this single reviewed manifest.

Configure each of these variables as a full Secret Manager resource ending in a positive numeric
version such as `projects/<production-project>/secrets/<secret>/versions/3`. `latest`, shorthand
selectors, and selectors from another project are rejected before any secret is read:

| Name | Value |
| --- | --- |
| `GLIDELINGO_MACOS_CERTIFICATE_SECRET_VERSION` | `glidelingo-desktop-macos-certificate-base64`; base64-encoded Developer ID `.p12` |
| `GLIDELINGO_MACOS_CERTIFICATE_PASSWORD_SECRET_VERSION` | `glidelingo-desktop-macos-certificate-password`; `.p12` password |
| `GLIDELINGO_APPLE_ID_SECRET_VERSION` | `glidelingo-desktop-apple-id`; Apple Account used for notarization |
| `GLIDELINGO_APPLE_APP_SPECIFIC_PASSWORD_SECRET_VERSION` | `glidelingo-desktop-apple-app-specific-password`; notarization password |
| `GLIDELINGO_APPLE_TEAM_ID_SECRET_VERSION` | `glidelingo-desktop-apple-team-id`; Apple Developer Team ID |
| `GLIDELINGO_CLERK_PUBLISHABLE_KEY_SECRET_VERSION` | `glidelingo-desktop-clerk-publishable-key`; Clerk production publishable key |
| `GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION` | `glidelingo-revenuecat-<mode>-web-public-key`; RevenueCat Web public SDK key |

The RevenueCat secret ID must be exactly `glidelingo-revenuecat-sandbox-web-public-key` or
`glidelingo-revenuecat-production-web-public-key` matching `GLIDELINGO_BILLING_MODE`. Use distinct Secret Manager containers for the two environments; do not
put sandbox and production values into versions of one container. The public SDK values are not
confidential, but storing their pinned build inputs in GCP gives the signed package one auditable
configuration source.

The Clerk publishable key must begin with `pk_live_`; the release command rejects development
`pk_test_` keys. In Clerk's production Native application, allowlist the official Electron SDK callback
`glidelingo://app/`. Keep the legacy `glidelingo://app/sign-in` and
`glidelingo://app/sso-callback` entries until older installed builds are no longer supported. Do not use
wildcard custom-protocol redirects or alternate authorities.

On macOS, `base64 < file | pbcopy` copies a file's encoded value without writing another secret file. Keep the originals in an approved secure location until credential rotation, then remove unsecured copies.

## Build and publish

### Lean operator flow

Desktop delivery has three separate proof levels. Do not treat an earlier level as evidence for a
later one:

| Proof | Command or action | What it proves |
| --- | --- | --- |
| Local behavior | `npm run dev:desktop` | Development auth, billing, API, persistence, and UI behavior |
| Local release preflight | `npm run desktop:release:preflight` | Version availability, clean dependency contracts, tests, and the unsigned DMG/ZIP/update-metadata shape |
| Signed draft acceptance | `npm run desktop:release:accept-draft -- desktop-v<version>` | The exact downloaded GitHub artifacts are signed, notarized, internally consistent, and universal |
| Published forward update | Install published `N`, then publish and accept `N+1` | The real updater downloads and installs the new signed release without losing user state |

The local preflight is the normal release-preparation command. Run it on the version-bump branch
before opening its pull request. It checks the ignored development `.env`, verifies that the desktop
manifest and lockfile versions match, refuses a version whose tag already exists locally or on
GitHub, runs the full-stack suite, and builds all six unsigned release-shaped artifacts in ignored
`release-dry-run/`. It then validates their checksums, updater metadata, packaged version, and x64 +
arm64 slices.

The preflight deliberately uses development configuration and unsigned output. It never reads
production release secrets, signs an app, publishes a release, or enables the updater. Its output is
verification evidence, never a distribution artifact. A failed preflight must be fixed before the
version PR is merged.

`desktop/package.json` is the desktop version source. Its version must match the root entry and
package entry in `desktop/package-lock.json`, and the eventual tag must be exactly
`desktop-v<version>`. Never move or reuse a desktop tag or replace a published binary. If a release
fails after its tag is created, increment the patch version and move forward.

Ordinary marketing-site changes under `website/` are not packaged into Electron and do not require
a desktop version bump. Changes to the Expo application under `src/`, the Electron shell under
`desktop/`, or packaged assets do require a new desktop release when they should reach installed
users.

For a signed local build, install the Developer ID identity in the login keychain, expose one supported notarization credential set, set `EXPO_PUBLIC_API_BASE_URL`, `GLIDELINGO_CLERK_ORIGIN`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY`, and `GLIDELINGO_BILLING_MODE`, and run:

```bash
npm run desktop:release
```

To exercise the universal package layout without reading Apple credentials or producing a
releasable binary, run `npm run desktop:package:dry-run`. Its separate builder overlay disables
signing and the post-sign/notarization hook and writes only to ignored `release-dry-run/`. It is
the faster app-layout diagnostic; use `desktop:release:preflight` for the complete pre-PR gate.

For CI, run the **Desktop Release** workflow manually with both the exact 40-character reviewed
`main` commit SHA and its existing protected release tag. Manual runs cannot select a branch,
pull-request ref, or off-main commit.

Publishing is tag-driven. The tag must match the version in `desktop/package.json`:

```text
desktop-v1.0.0 ↔ desktop/package.json version 1.0.0
```

Pushing that tag runs non-secret verification first and then waits for approval on the
`desktop-release-signing` environment. After approval it exchanges GitHub's OIDC token for the
dedicated GCP release identity, validates every pinned secret selector, and reads the seven release
inputs from Secret Manager. After signing and notarization, the workflow creates or updates a
**draft** GitHub Release. Reruns delete stale or partial draft assets, upload exactly
`GlideLingo-<version>-universal.dmg`, `GlideLingo-<version>-universal.zip`, both matching
`.blockmap` files, `latest-mac.yml`, and `SHA256SUMS.txt`. It verifies the names, upload state,
byte sizes, and GitHub SHA-256 digests. A run refuses to replace an already-published release.
Sandbox drafts are additionally marked as internal prereleases and carry a do-not-publish warning.
The workflow contains no public-publish or website-activation step. Only a production-mode draft
may proceed to the separately approved clean-Mac promotion process.

After the workflow succeeds, check out the exact tagged release commit and run:

```bash
npm run desktop:release:accept-draft -- desktop-v<version>
```

This command authenticates with the existing `gh` session, resolves even GitHub's internally
untagged draft representation, downloads the exact six assets by immutable release/asset identity,
and revalidates the remote digests. It separately extracts the updater ZIP and mounts the DMG
read-only, then applies `codesign`, Gatekeeper, stapler, version, and universal-architecture checks
to both app copies. Temporary mounts are detached even on failure. The downloaded files remain in
ignored `release-acceptance/desktop-v<version>/` for normal manual DMG installation. The command
cannot publish, install into `/Applications`, or change the website.

The packaged updater is fixed to the public `StefanosCodes/GlideLingo` GitHub Releases channel.
It runs once at launch only from a packaged, currently validly signed macOS app. Development,
unsigned, and non-macOS builds never contact the update service. When a newer published release
exists, GlideLingo asks before downloading and asks again before restarting to install; choosing
**Later** leaves the installed version untouched. Draft releases are intentionally invisible to
installed clients.

For each forward release, increment `desktop/package.json`, merge the reviewed change to `main`,
create the protected matching tag (for example `desktop-v1.0.1`), let the workflow converge the
draft, complete the clean-Mac gates below, and then publish that exact draft as the GitHub
**Latest** release. Never replace an
already-published binary or reuse its version/tag. Existing signed installations discover the
new published version on their next launch.

## Release gates

The automated workflow proves:

- the exact updater ZIP extracts to a valid Developer ID-signed, notarized universal app (not
  merely that the pre-archive build directory was valid);

- repository tests pass;
- Expo's web renderer exports successfully;
- electron-builder finds a Developer ID Application identity;
- Apple notarization succeeds and the ticket is stapled;
- `codesign` accepts the complete bundle;
- Gatekeeper accepts the application;
- the executable contains both x64 and arm64 slices;
- DMG and ZIP checksums are generated before upload.
- updater metadata and both blockmaps are present before the draft can converge.

Before linking a release from the public landing page, download the DMG onto a second clean Mac or a fresh macOS test profile, drag GlideLingo to Applications, and launch it normally. Exercise email/password signup, email-code verification, first-name onboarding, persistence, sign-out, sign-in, recovery, billing, lessons, audio, and production API access. Quit and relaunch to prove the stored Clerk session and local learning state restore cleanly. This installed-app smoke remains an activation gate even after automated draft acceptance passes.

The clean-Mac smoke test is currently external, so the workflow intentionally leaves every
release in draft state and contains no publish step. A sandbox build must remain a draft even when
its tests pass. Do not publish any sandbox draft or set
`PUBLIC_MAC_DOWNLOAD_STATE=active` until a later promotion lane can consume machine-verifiable
clean-Mac evidence from a production-mode build and an authorized approval. Until then, the landing
page remains in its explicit disabled state.

Before calling automatic updates release-ready, complete one real forward-update acceptance test:
install and launch a published signed/notarized version `N`, publish separately signed/notarized
version `N+1` through the same protected lane, relaunch `N`, accept both update prompts, and verify
that `N+1` starts with authentication state and local learning data intact. Also repeat once by
choosing **Later** at each prompt to prove no unattended install occurs. This signed `1.0.0` to
`1.0.1`-style forward exercise cannot be replaced by an unsigned local package test.

The authentication integration preserves the corrected desktop origin and OAuth contract:
FastAPI CORS allows the exact virtual renderer origin `https://desktop.glidelingo.com`, packaged
Electron serves signed local files at that origin and uses the system browser for OAuth, and
the callback handler accepts only the exact application authority and bounded callback routes.
The release command embeds only validated, exact API and Clerk origins in Electron package
metadata; the packaged defaults point to those same production services. The public Clerk key must belong
to the configured Clerk origin, and mock billing is rejected by release validation.

## Credential rotation and failure behavior

Create a new GCP Secret Manager version and update the protected environment's exact version
selector when a certificate or app-specific password is revoked, expires, or may have been exposed.
Disable the affected old version after the replacement build succeeds. Do not weaken the workflow
to ship an unsigned or unnotarized build. A failed client release is corrected by incrementing the
desktop version and publishing a new forward release; installed clients update only after explicit
user confirmation.
