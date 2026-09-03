# Clerk authentication MVP

Clerk is GlideLingo's identity authority on iOS, Android, web, Electron, and the FastAPI boundary. RevenueCat receives
only Clerk's stable `userId`; email addresses and phone numbers are never used as billing identifiers.

## Development instance

- Application: `GlideLingo`
- Frontend API / issuer: `https://vast-gator-9531.clerk.accounts.dev`
- Native identifier: `com.stefanoscodes.glidelingo`
- Android development signing certificate: registered in Clerk from the signed EAS development build
- Desktop MVP interface: email and password, with email-code verification during sign-up and password recovery.
- Google and Apple remain configured in Clerk but are intentionally hidden until their separate desktop acceptance slice.
- Profile requirement: first name only, collected by the app immediately after authentication
- Email is required for the desktop MVP account.
- MFA strategies and mandatory MFA are disabled for the MVP

Google and web Apple remain configured for the follow-up social-auth slice. Production social sign-in requires custom
provider credentials plus installed-build callback testing on each shipping platform. Phone authentication is deferred
to the mobile release and is not part of desktop development or production acceptance.

## Local configuration

Put the public Clerk key and server verifier endpoints in the ignored root `.env` or `.env.local` file. The backend reads
both files. Never expose a Clerk secret key through an `EXPO_PUBLIC_*` variable.

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
GLIDELINGO_CLERK_ISSUER=https://your-instance.clerk.accounts.dev
GLIDELINGO_CLERK_JWKS_URL=https://your-instance.clerk.accounts.dev/.well-known/jwks.json
GLIDELINGO_CLERK_AUTHORIZED_PARTIES=["http://localhost:8081","http://127.0.0.1:8081"]
```

Local Electron uses the development Clerk instance and a loopback FastAPI server. Production Clerk and API values are
injected only by the protected desktop release workflow; they do not belong in the local `.env`. Google and Apple OAuth
return through Clerk's public development frontend, so local authentication does not require a tunnel. A tunnel such as
ngrok is required only when an external service such as RevenueCat must deliver a webhook to local FastAPI.

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
5. Configure SMS countries and Clerk phone-auth pricing only when the separate mobile release adds phone authentication.
6. Inject production keys through EAS environments. Keep the Clerk secret key and RevenueCat secret API keys server-only.
7. In each Clerk Native application environment used by Electron, allowlist the official SDK callback
   `glidelingo://app/`. Keep `glidelingo://app/sign-in` and `glidelingo://app/sso-callback` while older
   distributed builds still need them. Do not allowlist a wildcard host, alternate authority, port,
   userinfo, or arbitrary custom-protocol path.

## Packaged Electron contract

- Signed builds serve packaged renderer files through Electron's exact virtual origin
  `https://desktop.glidelingo.com`. The origin has no DNS record or remote renderer deployment; all other HTTPS
  requests use Chromium's normal network handler. API CORS and Clerk authorized parties use this exact origin.
- The packaged renderer permits only the exact configured Clerk frontend and API origins. Ordinary development packages
  use the reviewed defaults in `desktop/runtime.cjs`; `desktop:release` validates the production origins, embeds them in
  Electron package metadata, and exports the web bundle with the matching public client configuration. Wildcard Clerk
  instance trust is intentionally rejected.
- Localhost browser and development Electron use `@clerk/react`. A preload bridge may exist in development, but bridge
  presence alone never selects native Clerk auth. Packaged Electron uses Clerk's official `@clerk/electron` main and
  React bridge. A sandbox-compatible preload exposes the
  official Clerk IPC shape without importing npm modules inside Electron's sandboxed preload runtime. Clerk persists the
  client token through macOS Keychain-backed encryption, marks API requests as native, and opens OAuth in the system
  browser. The installer registers the `glidelingo` protocol; the SDK callback is exactly `glidelingo://app/`. The
  older `/sign-in` and `/sso-callback` routes remain narrowly validated only for compatibility with already distributed
  builds.
- Social OAuth callback acceptance is a separate follow-up gate. Unit tests retain its parser and routing policy, but
  the email/password MVP neither opens OAuth popups nor depends on the `glidelingo://` callback.
- The internal diagnostics screen calls `GET /v1/auth/session` with the normal API client, compares FastAPI's verified
  subject to Clerk's current `userId`, and displays only match state, HTTP status, and request ID. It never renders the
  session token or either raw user ID.

## Verification checklist

- On desktop, create an account with email and password, verify the email code, complete first-name onboarding, refresh,
  sign out, sign back in, reset the password, and verify the refreshed session again.
- Confirm each new user is stopped at the one-field first-name screen before seeing learning content.
- Confirm sign-out returns to `/sign-in`, and another account cannot see the first account's browser learning state or Pro
  entitlement.
- Call `GET /v1/auth/session` with and without the Clerk bearer token; expect `200` and `401` respectively.
- Confirm Google, Apple, and phone are absent from the MVP interface while their provider configuration remains intact.

The exact desktop development and packaged acceptance procedure, including failure/cancellation recovery and the
remaining live-only gates, is maintained in [`infra/DESKTOP-AUTH-ACCEPTANCE.md`](infra/DESKTOP-AUTH-ACCEPTANCE.md).
