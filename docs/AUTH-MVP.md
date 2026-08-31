# Clerk authentication MVP

Clerk is GlideLingo's identity authority on iOS, Android, web, Electron, and the FastAPI boundary. RevenueCat receives
only Clerk's stable `userId`; email addresses and phone numbers are never used as billing identifiers.

## Development instance

- Application: `GlideLingo`
- Frontend API / issuer: `https://vast-gator-9531.clerk.accounts.dev`
- Native identifier: `com.stefanoscodes.glidelingo`
- Configured development sign-in methods: Apple, email verification code, and phone SMS code. Google is intentionally
  deferred so the shared Clerk instance cannot advertise an unconfigured provider in native builds.
- Profile requirement: first name only, collected by the app immediately after authentication
- Email and phone are alternatives; neither contact method is required when another sign-in method is used
- MFA strategies and mandatory MFA are disabled for the MVP

Web Apple can use Clerk's shared OAuth credentials in the development instance. Google must remain disabled in Clerk for
this MVP; enabling it is a separate native integration that must supply and verify each platform's OAuth configuration
before the shared provider is exposed anywhere. Production Apple requires custom provider credentials. Phone
authentication is free to exercise in development but is a Clerk Pro feature in production. The development SMS
allowlist starts with Clerk's two Tier A countries and is capped at 20 messages per month.

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
3. Keep Google disabled. Add native Google as a separate release slice with platform OAuth clients and an installed-build
   callback test before enabling it in the shared Clerk instance. Add the Android signing SHA-256 fingerprint to Clerk
   once EAS creates the signing certificate.
4. Replace Clerk's shared web Apple credentials with production OAuth credentials.
5. Choose the production SMS country allowlist and accept Clerk Pro pricing before shipping phone authentication.
6. Inject production keys through EAS environments. Keep the Clerk secret key and RevenueCat secret API keys server-only.

## Packaged Electron contract

- The packaged renderer permits only the exact configured Clerk frontend and API origins. Ordinary development packages
  use the reviewed defaults in `desktop/runtime.cjs`; `desktop:release` validates the production origins, embeds them in
  Electron package metadata, and exports the web bundle with the matching public client configuration. Wildcard Clerk
  instance trust is intentionally rejected.
- Packaged OAuth uses redirect mode and opens provider navigation in the system browser. The installer registers the
  `glidelingo` protocol. The main process enforces one app instance and accepts callbacks only at
  `glidelingo://app/sign-in` or `glidelingo://app/sso-callback`, with bounded parameter names/counts/values.
- Before publishing a signed artifact, install it, start an OAuth flow, confirm the system browser returns to the already
  running app, then repeat with the app initially closed. This signed-installed callback smoke is a release gate; unit
  tests prove parsing and routing policy but cannot prove operating-system registration.

## Verification checklist

- Sign up separately with Apple, email code, and phone code. Confirm Google is not offered in web or native UI.
- Confirm each new user is stopped at the one-field first-name screen before seeing learning content.
- Confirm sign-out returns to `/sign-in`, and another account cannot see the first account's browser learning state or Pro
  entitlement.
- Call `GET /v1/auth/session` with and without the Clerk bearer token; expect `200` and `401` respectively.
- Exercise popup OAuth in a normal browser and system-browser redirect OAuth in a signed, installed Electron package.
