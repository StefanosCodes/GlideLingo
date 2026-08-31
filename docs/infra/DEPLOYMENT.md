# Deployment Architecture

## One repository, separate releases

The monorepo produces multiple independently deployed artifacts:

```text
One Git commit
├── iOS application build
├── Android application build
├── Expo web export
├── Electron macOS package
├── FastAPI container
├── Worker process/container, later
├── Database migration job
└── Versioned curriculum publication
```

One repository does not require all artifacts to release together.

## Environment progression

### Local

- Expo/Metro on the developer machine.
- Electron on the developer machine.
- FastAPI on the developer machine when introduced.
- PostgreSQL through a project-owned local container when introduced.
- Safe local credentials only.

### Staging

- Deployable API artifact using staging secrets.
- Managed staging PostgreSQL.
- EAS preview/development mobile builds.
- Internal Electron package.
- Staging curriculum publication.
- Production-like CORS, authentication, and migration behavior.

### Production

- iOS through TestFlight and the Apple App Store.
- Android through Google Play testing tracks and production.
- Signed and notarized Electron macOS distribution.
- Web hosting only if a public web product is intentionally released.
- API on the chosen container/application platform.
- Managed PostgreSQL with backups and recovery.
- Workers and object storage only for features that need them.

## iOS lane

The intended Expo/EAS flow is:

```text
Verify shared application
→ EAS production build
→ signed IPA
→ EAS Submit
→ TestFlight
→ internal/external testing
→ App Store Review
→ controlled production release
```

Required configuration when this lane is implemented:

- Permanent iOS bundle identifier.
- Expo/EAS project configuration.
- Development, preview, and production build profiles.
- App Store Connect application record.
- Build-number strategy with automatic monotonic increments.
- App privacy, metadata, screenshots, age rating, and review information.
- Apple sign-in if other third-party social sign-in methods require it.
- Store-compliant purchase and account-deletion behavior.

Do not commit Apple credentials or App Store Connect private keys.

## Android lane

The parallel Android flow is:

```text
Verify shared application
→ EAS production build
→ signed Android App Bundle
→ internal testing track
→ closed/open testing as needed
→ production rollout
```

Required configuration includes a permanent Android application ID, signing keystore custody, Play Console record, data-safety metadata, store assets, billing compliance, and staged rollout controls.

## macOS Electron lane

The current Electron builder targets DMG and ZIP, so the recommended first macOS release is direct distribution rather than the Mac App Store.

```text
Verify Expo and Electron
→ export the Expo web bundle
→ package Electron
→ sign with Developer ID Application certificate
→ enable hardened runtime with required entitlements
→ submit to Apple notarization
→ staple the notarization ticket
→ verify code signature and Gatekeeper acceptance
→ install and smoke-test the DMG
→ publish the artifact
```

Direct distribution and the Mac App Store are separate channels. A future Mac App Store build requires its own target, certificates, provisioning, mandatory Apple App Sandbox entitlements, review path, and testing. Chromium’s Electron renderer sandbox is not the same as the Apple App Sandbox.

## Desktop authentication and deep links

Desktop OAuth must be tested in a signed and installed application, not only in development.

The final flow requires:

- System-browser authentication.
- Registered application URL protocol.
- Single-instance callback handling.
- Validation of callback origin and parameters.
- Recovery when the app is closed before the callback.
- Tests against signed/notarized packages.

The existing internal Electron protocol for loading packaged content is not, by itself, the complete operating-system OAuth callback implementation.

## API lane

The future FastAPI deployment should produce an immutable artifact and run migrations as a controlled release step.

```text
Backend checks
→ build immutable artifact
→ test migration against current schema
→ deploy compatible application version
→ run/confirm migration in defined order
→ readiness check
→ smoke critical API contract
→ monitor errors and latency
```

Exact ordering depends on the migration. Prefer additive expand-and-contract changes so old mobile clients and rolling server replicas remain compatible.

### Google Cloud development platform

The implemented development lane uses one public Cloud Run service, one Cloud SQL for
PostgreSQL instance, Artifact Registry, Secret Manager, and GitHub Workload Identity
Federation. Terraform configuration and the operating procedure live in
[`infra/gcp/README.md`](../../infra/gcp/README.md).

Cloud Run remains public at the network edge for installed clients. FastAPI owns application
authentication and resource authorization when those product endpoints are added. GitHub
deployments use short-lived OIDC credentials; the repository and GitHub settings must not
contain a Google service-account key.

## Worker lane

Workers may share the backend source and container image while using a different startup command. They remain an independent scaling and release unit.

A worker deployment must define:

- Supported job types.
- Queue/store dependency.
- Concurrency and database connection budget.
- Graceful shutdown and lease behavior.
- Retry policy and terminal recovery.
- Health/heartbeat behavior.
- Compatibility with API-produced jobs during rolling deployment.

## Database lane

PostgreSQL is a managed production dependency, not an application artifact.

Deployment requirements:

- Automated backups and tested restore procedure.
- Encryption and network access controls.
- Separate credentials per environment and role where appropriate.
- Connection limits with operational headroom.
- Migration history and deploy ordering.
- Monitoring for locks, saturation, storage, replication, and slow queries.
- Explicit retention and deletion behavior for learner and audio data.

## Curriculum publication

Course content should be validated and published separately from ordinary application deployment when practical.

```text
Authored content change
→ schema validation
→ reference/prerequisite validation
→ language review
→ immutable course-version publication
→ staged availability
```

Never mutate a published course version invisibly. Existing learner attempts remain linked to the version they used.

## Version compatibility

Mobile clients may remain installed for weeks or months after a server release. Therefore:

- APIs evolve additively by default.
- Required fields are not added to old requests without compatibility handling.
- Response fields are not removed until old clients are outside the support window.
- Database migrations support mixed application versions during rollout.
- Requests include safe client platform and version metadata.
- Critical incompatibility may require a minimum-supported-version policy.
- Course versions remain immutable.

## Secrets and signing material

Use EAS, CI, Apple/Google consoles, and cloud secret managers for:

- Expo access tokens.
- App Store Connect API keys.
- Apple signing certificates and passwords.
- Android signing keystores.
- Database credentials.
- Identity-provider secrets.
- Storage and model-provider credentials.
- Monitoring release tokens.

Never commit `.p8`, `.p12`, keystores, private keys, passwords, or production `.env` files.

## Release gates

Every production release should prove the relevant gates:

| Artifact | Required evidence |
| --- | --- |
| Shared client | Lint, types, feature tests, target runtime smoke |
| iOS | EAS build, TestFlight install, critical flow, metadata review |
| Android | EAS build, test-track install, critical flow, metadata review |
| macOS | Electron tests/export, signing, notarization, stapling, clean-install smoke |
| API | Unit/integration/contract tests, migration compatibility, readiness smoke |
| Worker | Duplicate/retry/timeout/shutdown tests and queue observability |
| Content | Schema, reference, language-review, and immutable-version checks |

## Rollback principles

- Client store releases normally move forward with a corrected build.
- Server artifacts should support rollback while migrations remain backward-compatible.
- Destructive migrations require staged removal after old code is gone.
- Curriculum publication should support disabling a version without rewriting its history.
- Failed jobs retain enough safe metadata for authorized retry or support recovery.

## Decisions still intentionally open

- Permanent company bundle/application identifier namespace.
- Production hosting provider.
- CI/CD provider and approval model.
- Direct-download hosting and update mechanism for Electron.
- Whether a Mac App Store build is commercially useful.
- Identity provider confirmation after mobile and signed-desktop OAuth spike.
- Speech, storage, and job-provider selection after measured evaluation.
- Exact billing/store architecture immediately before monetization work.

## Official references

- [Expo: create an EAS build](https://docs.expo.dev/build/setup/)
- [Expo: submit an iOS application](https://docs.expo.dev/submit/ios/)
- [Expo: application version management](https://docs.expo.dev/build-reference/app-versions/)
- [Apple: notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: Developer ID](https://developer.apple.com/support/developer-id/)
- [Electron: code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-builder: macOS notarization](https://www.electron.build/docs/features/code-signing/notarization/)
