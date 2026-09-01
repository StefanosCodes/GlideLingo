# RevenueCat billing MVP

This slice establishes an account-scoped subscription boundary for **lesson tutor assistance** without committing store
credentials or prices. Clerk owns authentication. RevenueCat owns purchases and the exact `pro` entitlement. RevenueCat
Billing uses Stripe as its web payment gateway; GlideLingo does not embed a Stripe SDK or Stripe secret. Do not enable
Clerk Billing for the same subscription.

## Integration contract

- Mount `BillingProvider` inside `ClerkProvider` and pass `userId={userId}` from Clerk's `useAuth()` result.
- Keep the provider mounted while Clerk finishes sign-out so it can clear logical RevenueCat ownership. It also clears
  visible entitlement state synchronously when the `userId` prop changes.
- Switch custom Clerk user IDs directly with RevenueCat `logIn()`. Do not call RevenueCat `logOut()` during application
  sign-out because it creates an unnecessary anonymous App User ID and alias.
- Identity changes, offering loads, purchases, and restores share one serialized queue so a purchase cannot finish under a
  different Clerk account during rapid sign-out or account switching.
- Never pass an email address or phone number as the RevenueCat App User ID.
- Register the `/subscription` route inside the authenticated Expo Router boundary and add the desired in-app entry point.
- Treat checkout state separately from entitlement state. Cancellation, a declined payment, or an ambiguous checkout error
  must not erase a previously confirmed entitlement. A successful checkout is followed by a `getCustomerInfo()` refresh.
- Use `CustomerInfo.managementURL` for subscription management. RevenueCat Billing returns its customer portal there;
  the React Native SDK's native `showManageSubscriptions()` method is not supported on Web/Electron.
- The client entitlement makes the UI responsive. Paid tutor calls are authorized independently in
  FastAPI from fresh server-owned state derived only from the verified Clerk principal. The API never
  accepts a client `isPro` boolean or submitted billing user ID.

## Public client configuration

Use public SDK keys only. Local development can place these variables in the ignored root `.env`; EAS/release environments
must inject the appropriate release values.

```dotenv
EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_WEB_API_KEY=
EXPO_PUBLIC_ENABLE_MOCK_BILLING=true # development only
```

Web/Electron prefers an explicit `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY` even in development, which makes local desktop builds
exercise the RevenueCat Billing configuration that issued that key. For Stripe-sandbox acceptance, use the Web public SDK
key from a dedicated RevenueCat Billing configuration connected to the intended Stripe sandbox (currently expected to
start with `rcb_...`). When the web key is absent, the Test Store `test_...` key is a local-development fallback only; it
does not exercise RevenueCat Billing or Stripe. Native development continues to prefer the Test Store key. Mock access
requires both a development bundle and the explicit `EXPO_PUBLIC_ENABLE_MOCK_BILLING=true` opt-in. A release build with no
platform key fails closed and exposes no mock package or Pro state. Never expose a RevenueCat secret API key through
`EXPO_PUBLIC_*`.

The signed desktop workflow receives `GLIDELINGO_REVENUECAT_WEB_API_KEY` in its protected GitHub environment and exports
it to the renderer as `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY`. For local Stripe-sandbox work, put the matching Billing Web
public SDK key in the ignored root `.env`. Never expose Stripe credentials, project-wide RevenueCat secret keys, or
webhook credentials through an `EXPO_PUBLIC_` variable.

## RevenueCat dashboard setup

1. Create the entitlement with the exact identifier `pro`.
2. Under **Web**, create a dedicated **RevenueCat Billing** app/config for sandbox acceptance and connect the intended
   Stripe sandbox as its payment gateway. Do not substitute a RevenueCat Test Store configuration. Follow RevenueCat's
   [Web SDK setup](https://www.revenuecat.com/docs/web/web-billing/web-sdk).
3. Create one recurring monthly product and one recurring annual product for Web. Prices, currencies, tax behavior, trials,
   and customer-facing names remain dashboard-owned.
4. Attach both products to `pro`, then add them to the current offering using RevenueCat's predefined Monthly and Annual
   package types. The client uses package type rather than hard-coded product IDs.
5. Enable and brand the RevenueCat Billing customer portal. Confirm an active web subscription returns a secure
   `managementURL`; see [Customer Portal](https://www.revenuecat.com/docs/web/web-billing/customer-portal).
6. Copy that configuration's Web **public SDK key** (currently expected to start with `rcb_...`) into
   `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY` locally and `GLIDELINGO_REVENUECAT_WEB_API_KEY` in the protected desktop release
   environment. Configure the server's `GLIDELINGO_REVENUECAT_API_KEY` with the exact same key so checkout and entitlement
   reconciliation address the same RevenueCat Billing configuration. Restart Metro after local env changes.
7. Sign in through Clerk, open `/subscription`, and verify the exact stable Clerk `userId` appears as the RevenueCat App
   User ID. Never use email or phone number as the App User ID.
8. Exercise the acceptance matrix below through that RevenueCat Billing configuration and its connected Stripe sandbox
   before using live mode.
9. Set RevenueCat restore behavior to **Keep with original App User ID** so restoring one store account cannot transfer a
   subscription between different Clerk accounts.

For development without a configured web app, create Test Store monthly and annual products, attach them to `pro`, add
Monthly and Annual packages to the current offering, and use `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`. Remove or temporarily
unset the explicit Web key to select that fallback. The in-memory mock remains a UI-only fallback and proves no RevenueCat
or Stripe behavior.

## Desktop acceptance matrix

Run these against a development Electron build using the dedicated sandbox Billing configuration's Web public SDK key
(currently expected to start with `rcb_...`) in both renderer and server, plus Stripe sandbox payment methods:

| Scenario | Required evidence |
| --- | --- |
| Monthly success | Hosted checkout completes, the post-checkout CustomerInfo refresh contains active `pro`, and the screen shows Pro tutor assistance. |
| Annual success | Same as monthly using the Annual package and the dashboard-configured annual price. |
| User cancellation | Screen reports cancellation, no Pro grant is invented, and the known entitlement state is preserved. |
| Declined/invalid payment | Screen reports that payment was not accepted, exposes a retry path, and preserves known entitlement state. |
| Ambiguous/network failure | Screen asks the user to refresh before retrying and does not claim purchase success. |
| Portal | An active customer opens the secure RevenueCat customer portal and can inspect/cancel the subscription. |
| Portal unavailable | Missing/null `managementURL` produces an explicit unavailable state without removing Pro. |
| Account switch | Switching Clerk users never paints or purchases against the previous user's entitlement. |
| Sign-out/in | Signed-out UI holds no Pro state; signing back in refreshes the matching RevenueCat customer. |
| Release config | A build without the Web key fails closed; development mock/Test Store settings cannot grant release access. |

Record the RevenueCat customer history and Stripe test/sandbox transaction for both successful plans. These external
artifacts are required before claiming live billing works; repository tests alone prove only client behavior.

With the explicit development-only mock flag and no public SDK key, the screen uses an in-memory mock package scoped to
the current signed-in account. Without either a real key or that development opt-in, billing is unavailable. Real native
purchases require an Expo development build; Expo Go is preview-only for this integration.

## Platform behavior

- iOS and Android use their separate public SDK keys and native purchase/restore flows.
- Browser and Electron use the Web key. Electron follows the web path because it packages the Expo web bundle. Its CSP
  includes the RevenueCat API/static endpoints and the Stripe/Paddle script, frame, form, and connection origins used by
  RevenueCat Web checkout.
- Web refreshes CustomerInfo rather than invoking the native restore API.
- Active customers open the RevenueCat/Stripe/Paddle management destination supplied by `CustomerInfo.managementURL`.
- Every platform uses the same authenticated Clerk user ID so a single RevenueCat customer receives the same `pro`
  entitlement across devices.

## Server authorization configuration

The FastAPI integration is disabled by default. Server-only values belong in the ignored root `.env`
for local development and Secret Manager in deployed environments; never prefix them with
`EXPO_PUBLIC_`:

```dotenv
GLIDELINGO_REVENUECAT_ENABLED=false
GLIDELINGO_REVENUECAT_ENVIRONMENT=SANDBOX
GLIDELINGO_REVENUECAT_API_KEY=
GLIDELINGO_REVENUECAT_PSEUDONYM_KEY=
GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION=
GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET=
```

`GLIDELINGO_REVENUECAT_API_KEY` is deliberately the app public SDK key used with RevenueCat's read-only
`GET /v1/subscribers/{app_user_id}` Customer Info endpoint. The value must identify the same RevenueCat configuration as
the client key for the environment being exercised: use `test_...` only when both sides use RevenueCat Test Store, or use
the dedicated Stripe-sandbox Billing configuration's Web public SDK key (currently expected to start with `rcb_...`) in
both `GLIDELINGO_REVENUECAT_API_KEY` and `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY` for real desktop sandbox acceptance. Do not
generate or supply a project-wide `sk_...` secret key; those keys can perform restricted write operations the entitlement
verifier does not need. The backend keeps the public key in server configuration to maintain one deployment contract.

Production must use a separate RevenueCat Billing configuration connected to the live Stripe environment. Configure the
renderer and server with that production configuration's matching Web public SDK key; never reuse the sandbox Billing
configuration or infer the correct configuration from a key prefix alone.

Create separate sandbox and production webhook integrations in RevenueCat. Set the dashboard
Authorization value to exactly `GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION`, enable RevenueCat HMAC
signing, and store the one-time signing secret as `GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET`.
Point the selected-environment integration to `POST /v1/billing/revenuecat/webhook`. RevenueCat signs
the exact raw body as `<unix_timestamp>.<raw_json_body>`; the API requires both credentials, applies a
five-minute signature tolerance, rejects oversized or invalid payloads, deduplicates event IDs, and
ignores events from the other store environment.

`GET /v1/billing/entitlements/pro` requires a valid Clerk session. It returns only the authenticated
principal's server view and reconciles missing or stale state through RevenueCat's server API with a
bounded timeout. Active state is fresh for 15 minutes by default. Missing, expired, stale, provider-
unavailable, or database-unavailable state always fails closed. After checkout, restore, or an explicit
refresh, the client calls authenticated `POST /v1/billing/entitlements/pro/reconcile` with no body. That
endpoint bypasses a fresh inactive cache and asks RevenueCat for the verified Clerk principal's current
state; it never accepts an app-user ID or entitlement assertion from the renderer. RevenueCat
`CustomerInfo` updates may refresh package and management metadata, but they cannot grant tutor access
without this server confirmation.

The paid tutor route returns `403 pro_required` only for a fresh, verified inactive entitlement. Stale,
disabled, provider-unavailable, or database-unavailable billing state returns `503 billing_unavailable`.
Tutor availability is checked first, so an unavailable tutor remains `503 lesson_tutor_unavailable`
without performing billing or provider work.

Apply `backend/migrations/002_revenuecat_entitlements.sql` with the migration operator and schedule
`maintenance_revenuecat_webhooks.sql` with a separate delete-capable maintenance identity before
enabling this integration.

## Deferred production work

- Apple App Store and Google Play billing products and prices.
- Production RevenueCat Billing/Stripe web configuration, live prices, webhooks, and secret provisioning.
- Per-actor and global protection for the forced reconciliation endpoint before enabling production
  billing; its provider call is bounded but intentionally uncached so checkout can converge immediately.
- Remote paywalls, analytics, trials, and launch copy.
- Account deletion and subscription-management policy/copy required for store release.

Before release, verify the Test Store key is absent, exercise every shipping platform in its real store sandbox, and add
server-owned authorization before protecting an API capability.
