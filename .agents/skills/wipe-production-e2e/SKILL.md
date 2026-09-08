---
name: wipe-production-e2e
description: Reset GlideLingo application data and execute a clean macOS desktop signup journey in either local development or production. Use for local/dev source-Electron acceptance or production testing from glidelingo.com through install, Clerk verification, onboarding, and relaunch; do not use for ordinary smoke tests.
---

# Reset an Environment and Run Desktop E2E

Produce evidence for a clean desktop journey in the environment the user names. Keep local and
production execution physically distinct; neither mode may silently fall back to the other.

Select the mode before any mutation:

- For `local` or `development`, read [references/local-journey.md](references/local-journey.md).
- For `production`, read [references/journey.md](references/journey.md).
- If the environment is ambiguous, ask; never infer production.

Use the repository's `operational-ui-e2e` guidance for evidence quality. Use browser control only
for the production website and Computer Use for visible macOS/Electron interactions.

## Authority and boundaries

- Execute a reset only when the current user request explicitly asks to reset that named environment
  and run the journey. Mentioning or asking about this skill is not authorization.
- In local mode, run only `npm run e2e:local:prepare -- --confirm glidelingo-local`. It must use the
  loopback-bound Docker database and must not call `gcloud`, the live site, or the installed app.
- In production mode, reset only `glidelingo-prod-50843312405/glidelingo-production-db/glidelingo`
  through `npm run e2e:production:prepare -- --confirm glidelingo-prod-50843312405`.
- Never drop the database or schema, clear `glidelingo_schema_migration`, disable backups/PITR, or
  broaden deletion beyond the reviewed application tables.
- Cloud SQL reset does not delete Clerk identities or client-local state. Require a never-used email
  for a true new-account test. Deleting a Clerk identity or local app data needs separate explicit
  authorization.
- Never write credentials or verification codes to files, shell commands, logs, screenshots, or the
  final report. Enter them only into the visible GlideLingo/Clerk UI after the user supplies them for
  that destination.

## Local execution

1. Record the exact worktree SHA and dirty files without reverting them.
2. Run the guarded local preparation command. Preserve the Docker volume and schema; tables that do
   not exist because their dormant feature has never been migrated are already clean.
3. Verify development configuration without printing secrets. Start PostgreSQL, the local API, Expo
   web, and source Electron through repository commands.
4. Launch Electron with a newly created temporary `--user-data-dir`. Keep that same profile for the
   relaunch proof, then remove it during deterministic teardown.
5. Create the account against the configured Clerk development instance, complete onboarding, quit,
   and relaunch with the same profile. Verify local API reachability and visible persistence.

Do not use the public website, production database, installed release, or production Clerk instance
as a substitute for missing local configuration.

## Production execution

1. Bind the run to the current public release and repository state. Record dirty files without
   reverting them.
2. Run the guarded preparation command. Require its before/after table counts, preserved migration
   ledger, successful-backup evidence, and temporary-operator cleanup.
3. Open `https://glidelingo.com/` in the controlled browser, inspect the visible macOS CTA, and click
   that CTA. This interaction—not the preparation command—must initiate the acceptance download.
4. Verify the downloaded DMG against the live website and published release checksum with
   `npm run e2e:production:verify-download -- /absolute/path/to/file.dmg`.
5. Use Computer Use to install/update the app from that DMG and launch the installed app. Do not
   bypass Gatekeeper, signing, notarization, EULA, or unexpected permission prompts.
6. If the app is already authenticated, use its visible sign-out path. Do not silently erase local
   application support, Keychain entries, or Clerk state.
7. At the signup form, obtain the user's designated fresh email/password if they have not already
   supplied them specifically for GlideLingo. Submit through the app, then pause for the mobile/email
   verification code and enter it only after the user supplies it for this flow.
8. Complete onboarding through visible controls, reach the authenticated learner experience, then
   quit and relaunch the installed app to prove session and onboarding persistence.
9. Inspect visible errors and relevant production health/runtime evidence. Report partial completion
   honestly if an OS dialog, CAPTCHA, OTP, account collision, or production failure blocks the graph.

Stop after one bounded retry for an unchanged destructive, authentication, or installation failure.
Do not reset either environment again merely because a later UI step failed.
