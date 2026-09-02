# Desktop authentication acceptance

This checklist is the evidence contract for GlideLingo desktop authentication. Automated checks prove code-level
contracts; they do not prove that Clerk, Google, Apple, email delivery, phone delivery, macOS protocol registration, or a
signed installed build is configured correctly. Record real observations for live steps and leave them unchecked until
they have actually run.

## Preconditions

1. Use an ignored root `.env` or `.env.local` with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `EXPO_PUBLIC_API_BASE_URL`. Configure the backend Clerk issuer, JWKS URL, and authorized parties as documented in
   [`../AUTH-MVP.md`](../AUTH-MVP.md). Never put a Clerk secret key in an `EXPO_PUBLIC_*` variable.
2. In Clerk, confirm the same development instance enables Google, Apple, email verification code, and phone SMS code.
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

- the sign-in copy contract names Google, Apple, email, and phone;
- callback parsing still accepts only `glidelingo://app/sign-in` and `glidelingo://app/sso-callback` with bounded
  parameters;
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

3. Confirm the signed-out screen says **Continue with Google, Apple, email, or phone** and Clerk renders the enabled
   choices.
4. Open each configured provider once. Confirm the OAuth popup remains inside the Electron auth child while it is on
   Clerk, Google, or Apple. Confirm an unrelated HTTPS link opens in the system browser instead of navigating the auth
   child.
5. Close an OAuth popup before completing it. Confirm the sign-in screen remains usable and a new attempt can start.
6. Navigate the renderer to `http://localhost:8081/sso-callback?error=access_denied`. Confirm it shows **Sign in was
   cancelled**, the account remains unchanged, and **Return to sign in** returns to a usable sign-in screen.
7. Navigate the renderer to `http://localhost:8081/sso-callback?error=server_error`. Confirm the callback handler fails
   closed and **Try sign in again** returns to a fresh sign-in screen.
8. Complete one real development sign-in. Open **Prompt Kit → Open system diagnostics**. Confirm:
   - readiness reports the API and database state;
   - **Authenticated session verified** appears;
   - the screen shows request metadata but no token and no raw Clerk user ID.
9. Sign out, sign in as a different test user, and repeat the diagnostics proof. Confirm browser learning state is not
   silently shared between the two identities.

Live development evidence to record:

- [ ] Google sign-in completed and returned to Electron.
- [ ] Apple sign-in completed and returned to Electron.
- [ ] Email verification-code sign-in completed.
- [ ] Phone SMS-code sign-in completed.
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
2. With GlideLingo already running, start Google sign-in. Confirm the system browser opens, authentication completes,
   and macOS routes the `glidelingo://app/...` callback into that same running app. Repeat with Apple. This is the warm
   callback test.
3. Fully quit GlideLingo. Start a new provider flow, arrange for its callback while the app is closed, and confirm macOS
   launches `/Applications/GlideLingo.app` and completes the sign-in. Repeat for Google and Apple. This is the cold
   callback test.
4. Cancel a provider flow and confirm the installed app returns to an actionable sign-in state without authenticating or
   becoming stuck on the callback screen.
5. Complete email-code and phone-code sign-in in the installed app.
6. Open **Prompt Kit → Open system diagnostics** and confirm **Authenticated session verified** against the production
   API. Capture only the result and request ID; never capture the token or raw user ID.
7. Quit and relaunch. Confirm the intended Clerk session persists, sign-out clears it, and a second account cannot see
   the first account's user-scoped learning state.

Live packaged evidence to record:

- [ ] Signed/notarized DMG installed on a clean Mac and passed Gatekeeper.
- [ ] Google warm callback passed.
- [ ] Google cold callback passed.
- [ ] Apple warm callback passed.
- [ ] Apple cold callback passed.
- [ ] Provider cancellation recovery passed.
- [ ] Email verification-code sign-in passed.
- [ ] Phone SMS-code sign-in passed.
- [ ] First-name completion, session persistence, sign-out, account isolation, and diagnostics proof passed.

Do not mark these packaged gates complete from unit tests, an Expo web session, a dry-run package, or an unsigned local
bundle. Do not publish a release or enable the website download until the signed-installed evidence is real.
