# Production desktop journey

## Acceptance graph

`production reset → live website CTA → public DMG → checksum → Finder install → Gatekeeper launch → new Clerk account → OTP → onboarding → authenticated app → quit/relaunch`

Every arrow needs observed evidence from the same run. A release-workflow green check, source build,
or API-only smoke test cannot replace a missing consumer step.

## Preparation evidence

- Exact project: `glidelingo-prod-50843312405`
- Exact instance/database: `glidelingo-production-db/glidelingo`
- Backups enabled, PITR enabled, and a successful backup present
- Before/after counts for `lesson_tutor_turn_guard`, `revenuecat_entitlement_state`, and
  `revenuecat_webhook_event`
- `glidelingo_schema_migration` count unchanged
- No `glidelingo_reset_*` operator remains
- Live website resolves one unique `desktop-vX.Y.Z/GlideLingo-X.Y.Z-universal.dmg`

## Download and installation evidence

- The visible CTA on `glidelingo.com` initiated the download
- Filename, semantic version, tag, SHA-256, and downloaded byte size agree
- DMG opens normally; do not suppress macOS trust checks
- Installed app reports the expected version and runs from the installed location
- Capture any replacement prompt, Gatekeeper outcome, crash, or unexpected permission request

## Account and persistence evidence

- Use a new Clerk email. Cloud SQL contains no user-account table, so the database reset cannot make
  an existing Clerk email new again.
- Credentials and OTP remain redacted from all evidence.
- Observe signup, code acceptance, onboarding completion, authenticated landing state, clean quit,
  relaunch, restored session, and restored onboarding state.
- If useful, exercise one safe visible learning action and verify it persists after relaunch. Do not
  enable billing or the dormant lesson tutor as part of this journey.

## Final report

State the public version/tag/checksum, production table counts, migration-ledger preservation,
installation result, account/onboarding result, relaunch result, and any remaining gap. Distinguish
Cloud SQL state, Clerk identity state, and client-local state.
