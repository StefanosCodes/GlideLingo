# Clerk authentication MVP

Clerk is GlideLingo's identity authority on iOS, Android, web, Electron, and the FastAPI boundary. RevenueCat receives
only Clerk's stable `userId`; email addresses and phone numbers are never used as billing identifiers.

## Development instance

- Application: `GlideLingo`
- Frontend API / issuer: `https://vast-gator-9531.clerk.accounts.dev`
- Native identifier: `com.stefanoscodes.glidelingo`
- Sign-in methods: Google, Apple, email verification code, and phone SMS code
- Profile requirement: first name only, collected by the app immediately after authentication
- Email and phone are alternatives; neither contact method is required when another sign-in method is used
- MFA strategies and mandatory MFA are disabled for the MVP

Google and Apple use Clerk's shared OAuth credentials in the development instance. Production requires custom provider
credentials. Phone authentication is free to exercise in development but is a Clerk Pro feature in production. The
development SMS allowlist starts with Clerk's two Tier A countries and is capped at 20 messages per month.

## Local configuration

Put the public Clerk key and server verifier endpoints in the ignored root `.env` or `.env.local` file. The backend reads
both files. Never expose a Clerk secret key through an `EXPO_PUBLIC_*` variable.

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
GLIDELINGO_CLERK_ISSUER=https://your-instance.clerk.accounts.dev
GLIDELINGO_CLERK_JWKS_URL=https://your-instance.clerk.accounts.dev/.well-known/jwks.json
```

The app automatically attaches Clerk's current signed session token to API requests. FastAPI verifies its RS256 signature,
issuer, expiry, and subject against Clerk's JWKS. An optional `GLIDELINGO_CLERK_AUDIENCE` can add audience validation when
the app later requests a matching Clerk JWT template.

Existing unscoped browser learning progress is never assigned automatically. The Progress screen asks the signed-in user
to import or reject it; importing moves the legacy data into that Clerk user's storage and removes the shared legacy copy.

## Release prerequisites

1. Sign in to Expo EAS and create development builds; Expo Go cannot exercise the native Clerk and RevenueCat modules.
2. Add the Apple Developer Team ID / App ID Prefix to Clerk's iOS native application and enable Sign in with Apple for
   `com.stefanoscodes.glidelingo`.
3. Add the Android signing SHA-256 fingerprint to Clerk once EAS creates the signing certificate.
4. Replace Clerk's shared Google and Apple credentials with production OAuth credentials.
5. Choose the production SMS country allowlist and accept Clerk Pro pricing before shipping phone authentication.
6. Inject production keys through EAS environments. Keep the Clerk secret key and RevenueCat secret API keys server-only.

## Verification checklist

- Sign up separately with Google, Apple, email code, and phone code.
- Confirm each new user is stopped at the one-field first-name screen before seeing learning content.
- Confirm sign-out returns to `/sign-in`, and another account cannot see the first account's browser learning state or Pro
  entitlement.
- Call `GET /v1/auth/session` with and without the Clerk bearer token; expect `200` and `401` respectively.
- Exercise popup OAuth in packaged Electron as well as a normal browser.
