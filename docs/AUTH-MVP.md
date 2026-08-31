# Clerk authentication MVP

Clerk is GlideLingo's identity authority on iOS, Android, web, Electron, and the FastAPI boundary. RevenueCat receives
only Clerk's stable `userId`; email addresses and phone numbers are never used as billing identifiers.

## Development instance

- Application: `GlideLingo`
- Frontend API / issuer: `https://vast-gator-9531.clerk.accounts.dev`
- Native identifier: `com.stefanoscodes.glidelingo`
- Android development signing certificate: registered in Clerk from the signed EAS development build
- Configured development sign-in methods: Google, Apple, email verification code, and phone SMS code.
- Profile requirement: first name only, collected by the app immediately after authentication
- Email and phone are alternatives; neither contact method is required when another sign-in method is used
- MFA strategies and mandatory MFA are disabled for the MVP

Google and web Apple use Clerk's shared OAuth credentials in the development instance. Production requires custom Google
and Apple provider credentials plus installed-build callback testing on each shipping platform. Phone authentication is
free to exercise in development but is a Clerk Pro feature in production. The development SMS allowlist starts with
Clerk's two Tier A countries and is capped at 20 messages per month.

## Local configuration

Put the public Clerk key and server verifier endpoints in the ignored root `.env` or `.env.local` file. The backend reads
both files. Never expose a Clerk secret key through an `EXPO_PUBLIC_*` variable.

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
GLIDELINGO_CLERK_ISSUER=https://your-instance.clerk.accounts.dev
GLIDELINGO_CLERK_JWKS_URL=https://your-instance.clerk.accounts.dev/.well-known/jwks.json
GLIDELINGO_CLERK_AUTHORIZED_PARTIES=["http://localhost:8081","http://127.0.0.1:8081","glidelingo://app"]
```

The app automatically attaches Clerk's current signed session token to API requests. FastAPI verifies its RS256 signature,
issuer, expiry, and subject against Clerk's JWKS. When a token includes Clerk's `azp` claim, FastAPI accepts it only when
it exactly matches `GLIDELINGO_CLERK_AUTHORIZED_PARTIES`; native tokens without `azp` remain valid. An optional
`GLIDELINGO_CLERK_AUDIENCE` can add audience validation when the app later requests a matching Clerk JWT template.

Existing unscoped browser learning progress is never assigned automatically. The Progress screen asks the signed-in user
to import or reject it; importing moves the legacy data into that Clerk user's storage and removes the shared legacy copy.

## Release prerequisites

1. The app is linked to `@stefanoscodes/glidelingo` in Expo EAS. Configure signing and create development builds; Expo Go
   cannot exercise the native Clerk and RevenueCat modules.
2. Add the Apple Developer Team ID / App ID Prefix to Clerk's iOS native application and enable Sign in with Apple for
   `com.stefanoscodes.glidelingo`.
3. Before production, register the Google Play app-signing SHA-256 fingerprint in Clerk, replace Clerk's shared Google
   credentials with platform-owned OAuth credentials, and pass installed-build callback tests on Android and iOS.
4. Replace Clerk's shared web Apple credentials with production OAuth credentials.
5. Choose the production SMS country allowlist and accept Clerk Pro pricing before shipping phone authentication.
6. Inject production keys through EAS environments. Keep the Clerk secret key and RevenueCat secret API keys server-only.
7. In Clerk's production Native application, allowlist both exact desktop redirect URLs:
   `glidelingo://app/sign-in` and `glidelingo://app/sso-callback`. Do not allowlist a wildcard host,
   alternate authority, port, userinfo, or arbitrary custom-protocol path.

## Packaged Electron contract

- The packaged renderer permits only the exact configured Clerk frontend and API origins. Ordinary development packages
  use the reviewed defaults in `desktop/runtime.cjs`; `desktop:release` validates the production origins, embeds them in
  Electron package metadata, and exports the web bundle with the matching public client configuration. Wildcard Clerk
  instance trust is intentionally rejected.
- Packaged OAuth uses redirect mode and opens provider navigation in the system browser. The installer registers the
  `glidelingo` protocol. The main process enforces one app instance and accepts callbacks only at
  `glidelingo://app/sign-in` or `glidelingo://app/sso-callback`, with bounded parameter names/counts/values.
- Before publishing a signed artifact, install it, start an OAuth flow, confirm the system browser returns to the already
  running app (warm callback), then repeat with the app initially closed (cold callback). These signed-installed warm and
  cold OAuth callback smokes remain activation gates; unit tests prove parsing and routing policy but cannot prove
  operating-system registration or Clerk Native application allowlisting.
- Development Electron popup windows may navigate only among the exact configured Clerk origin, Google, Apple, and the
  exact loopback renderer origin that opened the flow. The same policy is installed on every auth child window and its
  nested window attempts; unrelated HTTPS destinations leave Electron and open in the system browser.
- The internal diagnostics screen calls `GET /v1/auth/session` with the normal API client, compares FastAPI's verified
  subject to Clerk's current `userId`, and displays only match state, HTTP status, and request ID. It never renders the
  session token or either raw user ID.

## Verification checklist

- Sign up separately with Google, Apple, email code, and phone code on every shipping platform.
- Confirm each new user is stopped at the one-field first-name screen before seeing learning content.
- Confirm sign-out returns to `/sign-in`, and another account cannot see the first account's browser learning state or Pro
  entitlement.
- Call `GET /v1/auth/session` with and without the Clerk bearer token; expect `200` and `401` respectively.
- Exercise popup OAuth in a normal browser and system-browser redirect OAuth in a signed, installed Electron package.

The exact desktop development and packaged acceptance procedure, including failure/cancellation recovery and the
remaining live-only gates, is maintained in [`infra/DESKTOP-AUTH-ACCEPTANCE.md`](infra/DESKTOP-AUTH-ACCEPTANCE.md).
