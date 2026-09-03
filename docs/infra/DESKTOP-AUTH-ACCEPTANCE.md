# Desktop authentication acceptance

This checklist is the evidence contract for GlideLingo desktop authentication. Automated checks prove code-level
contracts; they do not prove that Clerk, Google, Apple, email delivery, macOS protocol registration, or a
signed installed build is configured correctly. Record real observations for live steps and leave them unchecked until
they have actually run.

Desktop MVP authentication is email plus password, with email-code verification during sign-up and password recovery.
Google and Apple remain configured but hidden until a separate social-auth slice. Phone SMS remains deferred to mobile.

## Preconditions

1. Use an ignored root `.env` or `.env.local` with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `EXPO_PUBLIC_API_BASE_URL`. Configure the backend Clerk issuer, JWKS URL, and authorized parties as documented in
   [`../AUTH-MVP.md`](../AUTH-MVP.md). Never put a Clerk secret key in an `EXPO_PUBLIC_*` variable.
2. In Clerk development and production, confirm open registration, required email, password sign-up, email-code sign-up
   verification, and an eight-character minimum password. Keep MFA off for this MVP.
3. Confirm the API is using that Clerk instance and accepts the development renderer origins. Do not paste session
   tokens into this checklist, screenshots, terminal output, or PR comments.
4. Install exact dependencies with `npm ci` and `npm run setup:backend`.

## Automated contract checks

From the repository root, run:

```bash
npm run test:auth
npm run test:desktop
npm run typecheck
npm run lint
npm run desktop:export
```

Expected evidence:

- branded sign-in, sign-up, verification, and recovery routes use stable test IDs and map upstream errors to safe copy;
- the sign-up flow mounts Clerk's required `clerk-captcha` container and prevents duplicate submissions;
- Clerk's official Electron bridge is wired across main and renderer; the sandboxed preload exposes the exact IPC
  shape that bridge expects and the flow uses the exact `glidelingo://app/` callback;
- packaged navigation remains on the virtual local origin `https://desktop.glidelingo.com`, while unrelated HTTPS
  traffic is forwarded to Chromium's built-in network handler;
- development auth child navigation accepts only the exact Clerk instance, Google, Apple, and exact renderer origin;
- Electron continues to use `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`;
- the typed `/v1/auth/session` client proves both identity match and mismatch behavior without returning a token;
- the Expo web export completes.

## Development Electron acceptance

1. Start PostgreSQL and FastAPI:

   ```bash
   npm run db:up
   npm run api
   ```

2. In a second terminal, start Expo web and Electron:

   ```bash
   npm run desktop
   ```

3. Confirm the signed-out screen offers email, password, account creation, and password recovery without Clerk branding,
   social buttons, raw SDK errors, identifiers, or tokens.
4. Create a disposable test account, verify its email code, and confirm the first-name gate appears before learning
   content. Refresh and confirm the session remains authenticated.
5. Sign out, sign back in with the same password, refresh, and confirm the session remains authenticated.
6. Sign out, complete password recovery by email code, set a new password, and confirm other sessions are revoked.
   Refresh, sign out, then sign in with the new password.
7. Exercise invalid credentials, weak/mismatched passwords, invalid and expired codes, resend cooldown, cancellation,
   retry, and rapid duplicate submission. Confirm every failure remains actionable and uses GlideLingo copy.
8. Open **Prompt Kit → Open system diagnostics**. Confirm:
   - readiness reports the API and database state;
   - **Authenticated session verified** appears;
   - the screen shows request metadata but no token and no raw Clerk user ID.
9. Sign out, then sign in as a different test user. Repeat diagnostics
   after each transition and confirm learning state is not silently shared between identities.

Live development evidence to record:

- [ ] Email/password sign-up and email-code verification completed.
- [ ] Refresh persistence, sign-out, and password sign-in completed.
- [ ] Password recovery, other-session revocation, and new-password sign-in completed.
- [ ] New users were stopped at first-name completion before learning content.
- [ ] Diagnostics reported an authenticated subject match for each exercised account.

## Packaged installed acceptance

An unsigned dry run can prove packaging layout but cannot satisfy the installed OAuth gate:

```bash
npm run desktop:package:dry-run
```

For release acceptance, produce the signed and notarized universal artifact using the protected credentials and exact
environment described in [`DESKTOP-RELEASE.md`](DESKTOP-RELEASE.md):

```bash
npm run desktop:release
```

Then use the DMG produced under `release/`:

1. Copy the DMG to a clean secondary Mac, open it, drag **GlideLingo** to `/Applications`, and launch it from Finder.
2. Create an account with email and password, verify the production email code, complete first-name onboarding, and
   confirm a refresh preserves the session.
3. Sign out, sign in again, quit, relaunch, and confirm the intended session persists.
4. Complete password recovery, set a new password, sign out, and sign in with the new password.
5. Confirm Google, Apple, and phone are absent from this MVP interface.
6. Open **Prompt Kit → Open system diagnostics** and confirm **Authenticated session verified** against the production
   API. Capture only the result and request ID; never capture the token or raw user ID.
7. Quit and relaunch. Confirm the intended Clerk session persists, sign-out clears it, and a second account cannot see
   the first account's user-scoped learning state.

Live packaged evidence to record:

- [ ] Signed/notarized DMG installed on a clean Mac and passed Gatekeeper.
- [ ] Email/password signup and email verification passed.
- [ ] Password sign-in, recovery, and new-password sign-in passed.
- [ ] First-name completion, session persistence, sign-out, account isolation, and diagnostics proof passed.

Do not mark these packaged gates complete from unit tests, an Expo web session, a dry-run package, or an unsigned local
bundle. Do not publish a release or enable the website download until the signed-installed evidence is real.
