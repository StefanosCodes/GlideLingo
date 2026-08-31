# Desktop release operations

## What this release lane produces

GlideLingo's first desktop channel is a direct macOS download, not the Mac App Store. One release produces:

- a universal DMG for users;
- a universal ZIP for release/update infrastructure;
- SHA-256 checksums;
- a signed and notarized `GlideLingo.app` containing both x64 and arm64 code.

Expo exports the shared web renderer. Electron packages that renderer and restricts packaged API requests to the origin derived from `EXPO_PUBLIC_API_BASE_URL`. `npm run desktop:release` fails before packaging when production HTTPS or notarization configuration is missing, and electron-builder fails when it cannot produce a real Developer ID signature.

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

Configure these Actions secrets:

| Name | Value |
| --- | --- |
| `MACOS_CERTIFICATE_BASE64` | Base64-encoded Developer ID `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Personal Stefanos Sophocleous Apple Account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password created for GlideLingo notarization |
| `APPLE_TEAM_ID` | Personal Stefanos Sophocleous Apple Developer Team ID |

Configure this Actions variable:

| Name | Value |
| --- | --- |
| `GLIDELINGO_PRODUCTION_API_ORIGIN` | Public HTTPS FastAPI base URL used by the production client |

On macOS, `base64 < file | pbcopy` copies a file's encoded value without writing another secret file. Keep the originals in an approved secure location until credential rotation, then remove unsecured copies.

## Build and publish

For a signed local build, install the Developer ID identity in the login keychain, expose one supported notarization credential set in the environment, set `EXPO_PUBLIC_API_BASE_URL`, and run:

```bash
npm run desktop:release
```

For CI, run the **Desktop Release** workflow manually to produce a private workflow artifact without publishing a GitHub Release.

Publishing is tag-driven. The tag must match the version in `desktop/package.json`:

```text
desktop-v1.0.0 ↔ desktop/package.json version 1.0.0
```

Pushing that tag runs verification, creates the signed/notarized universal artifacts, and publishes a GitHub Release only after every release gate succeeds.

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

Before linking a release from the public landing page, download the DMG onto a second clean Mac, drag GlideLingo to Applications, launch it normally, and exercise the critical lesson, audio, persistence, and production API flows.

## Credential rotation and failure behavior

Replace the affected GitHub secret when a certificate or app-specific password is revoked, expires, or may have been exposed. Do not weaken the workflow to ship an unsigned or unnotarized build. A failed client release is corrected by incrementing the desktop version and publishing a new forward release; already downloaded desktop binaries are not silently replaced.
