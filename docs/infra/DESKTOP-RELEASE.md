# Desktop release operations

## What this release lane produces

GlideLingo's first desktop channel is a direct macOS download, not the Mac App Store. One release produces:

- a universal DMG for users;
- a universal ZIP for release/update infrastructure;
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

## GitHub configuration

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

Configure these as environment secrets on `desktop-release-signing`, not as unprotected
repository-level secrets:

| Name | Value |
| --- | --- |
| `MACOS_CERTIFICATE_BASE64` | Base64-encoded Developer ID `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Personal Stefanos Sophocleous Apple Account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password created for GlideLingo notarization |
| `APPLE_TEAM_ID` | Personal Stefanos Sophocleous Apple Developer Team ID |

Configure these environment variables on `desktop-release-signing`. They are public client values,
not secrets, but the protected environment keeps the complete release configuration under the same
approval boundary as signing:

| Name | Value |
| --- | --- |
| `GLIDELINGO_PRODUCTION_API_ORIGIN` | Public HTTPS FastAPI base URL used by the production client |
| `GLIDELINGO_PRODUCTION_CLERK_ORIGIN` | Exact HTTPS Clerk frontend origin allowed by the packaged shell |
| `GLIDELINGO_CLERK_PUBLISHABLE_KEY` | Clerk public production publishable key for that exact frontend origin |
| `GLIDELINGO_REVENUECAT_WEB_API_KEY` | RevenueCat public Web SDK key used by Electron |

The Clerk publishable key must begin with `pk_live_`; the release command rejects development
`pk_test_` keys. In Clerk's production Native application, allowlist exactly
`glidelingo://app/sign-in` and `glidelingo://app/sso-callback`. Do not use wildcard custom-protocol
redirects or alternate authorities.

On macOS, `base64 < file | pbcopy` copies a file's encoded value without writing another secret file. Keep the originals in an approved secure location until credential rotation, then remove unsecured copies.

## Build and publish

For a signed local build, install the Developer ID identity in the login keychain, expose one supported notarization credential set, set `EXPO_PUBLIC_API_BASE_URL`, `GLIDELINGO_CLERK_ORIGIN`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY`, and run:

```bash
npm run desktop:release
```

To exercise the universal package layout without reading Apple credentials or producing a
releasable binary, run `npm run desktop:package:dry-run`. Its separate builder overlay disables
signing and the post-sign/notarization hook and writes only to ignored `release-dry-run/`. It is
verification evidence, never a distribution artifact.

For CI, run the **Desktop Release** workflow manually with both the exact 40-character reviewed
`main` commit SHA and its existing protected release tag. Manual runs cannot select a branch,
pull-request ref, or off-main commit.

Publishing is tag-driven. The tag must match the version in `desktop/package.json`:

```text
desktop-v1.0.0 ↔ desktop/package.json version 1.0.0
```

Pushing that tag runs non-secret verification first and then waits for approval on the
`desktop-release-signing` environment. After signing and notarization, the workflow creates or
updates a **draft** GitHub Release. Reruns delete stale or partial draft assets, upload exactly
`GlideLingo-<version>-universal.dmg`, `GlideLingo-<version>-universal.zip`, and
`SHA256SUMS.txt`, and verify the names, upload state, byte sizes, and GitHub SHA-256 digests. A run refuses to replace an
already-published release.

## Release gates

The automated workflow proves:

- repository tests pass;
- Expo's web renderer exports successfully;
- electron-builder finds a Developer ID Application identity;
- Apple notarization succeeds and the ticket is stapled;
- `codesign` accepts the complete bundle;
- Gatekeeper accepts the application;
- the executable contains both x64 and arm64 slices;
- DMG and ZIP checksums are generated before upload.

Before linking a release from the public landing page, download the DMG onto a second clean Mac, drag GlideLingo to Applications, launch it normally, and exercise the critical lesson, audio, persistence, and production API flows. With the installed signed app, prove the system-browser OAuth callback both while GlideLingo is already running (warm callback) and while it is fully closed (cold callback). These installed OAuth smokes remain activation gates even after unit and packaging checks pass.

The clean-Mac smoke test is currently external, so the workflow intentionally leaves every
release in draft state and contains no publish step. Do not publish the draft or set
`PUBLIC_MAC_DOWNLOAD_STATE=active` until a later promotion lane can consume machine-verifiable
clean-Mac evidence and an authorized approval. Until then, the landing page remains in its
explicit disabled state.

The authentication integration preserves the corrected desktop origin and OAuth contract:
FastAPI CORS allows `glidelingo://app`, packaged Electron uses the system browser for OAuth, and
the callback handler accepts only the exact application authority and bounded callback routes.
The release command embeds only validated, exact API and Clerk origins in Electron package
metadata; the default development origins remain exact as well. The public Clerk key must belong
to the configured Clerk origin, and mock billing is rejected by release validation.

## Credential rotation and failure behavior

Replace the affected GitHub secret when a certificate or app-specific password is revoked, expires, or may have been exposed. Do not weaken the workflow to ship an unsigned or unnotarized build. A failed client release is corrected by incrementing the desktop version and publishing a new forward release; already downloaded desktop binaries are not silently replaced.
