# GlideLingo RevenueCat context

## Executive summary

RevenueCat should be GlideLingo's subscription and entitlement control plane. It should normalize purchases from Apple,
Google, and web billing into one access decision such as the `pro` entitlement.

RevenueCat does **not** replace:

- GlideLingo authentication or account ownership.
- FastAPI and PostgreSQL.
- Course enrollment, lesson progress, attempts, mastery, or review state.
- Server-side authorization for paid API capabilities.

The intended boundary is:

```text
App Store / Google Play / web checkout
                  ↓
             RevenueCat
       active entitlement: "pro"
             ↙          ↘
      GlideLingo UI    FastAPI authorization
```

## Current GlideLingo state

GlideLingo currently contains the Expo/React Native clients and the Electron host. It does not yet have authentication,
a backend, a database, workers, or production billing.

Current learning state lives in `src/providers/learning-provider.tsx`. Browser and Electron state is written to
`localStorage`; native state currently falls back to memory. RevenueCat therefore should not be treated as an account
system or added as a substitute for durable learner persistence.

The planned architecture assigns:

- Product UI to the shared Expo application.
- Web behavior, including Electron renderer behavior, to the Expo web implementation.
- Verified identity, authorization, and paid API enforcement to FastAPI.
- Durable learner state and entitlement references to PostgreSQL.
- Purchase lifecycle normalization to RevenueCat.

The implementation roadmap places monetization after validating the learning loop and establishing persistent,
authenticated learners. An MVP billing boundary can still be developed now, provided it remains mockable and does not
pretend production billing is complete.

## What RevenueCat owns

- Product and offering retrieval for the paywall.
- Purchase and restore flows.
- Subscription lifecycle state, including renewal, cancellation, expiration, refund, and trial state.
- Mapping multiple store products to the shared `pro` entitlement.
- Cross-platform subscription status when every client uses the same stable RevenueCat App User ID.
- Subscription lifecycle notifications sent to the future backend through authenticated webhooks.

## What GlideLingo owns

- User authentication and the stable internal user ID supplied to RevenueCat.
- Which screens and operations require Pro.
- Free-tier limits and premium learning rules.
- Server-side authorization for expensive or premium API operations.
- Durable learner data, account deletion, and data export.
- Webhook idempotency, reconciliation, observability, and recovery.
- Store-compliant copy and purchase routing for each distribution channel and region.

The backend must never trust a client-supplied value such as `isPro: true`. The client entitlement is appropriate for
responsive UI, but the future FastAPI billing boundary must independently establish access for protected server work.

## Platform model

### iOS and Android

Use RevenueCat's `react-native-purchases` SDK with the platform-specific public SDK key. Real native purchase testing
requires an Expo development build. Expo Go can preview subscription code but does not perform real store purchases.

### Web and Electron

Electron runs GlideLingo's Expo web bundle, so it follows the web billing path. RevenueCat web billing can use RevenueCat
Billing, Stripe Billing, or Paddle Billing while granting the same `pro` entitlement used on mobile.

Web products are configured separately from Apple and Google products. All products should attach to the same logical
entitlement. The same authenticated App User ID must be used on every platform for cross-platform access.

## MVP branch already prepared

A local branch contains a working starter implementation:

```text
Branch: feat/revenuecat-mvp
Commit: 7f4e966
```

It was built in an isolated worktree so the uncommitted `feat/google-tts-static-audio` changes were not modified.

The branch includes:

- `react-native-purchases` 10.8.1.
- A platform-aware RevenueCat adapter.
- A `BillingProvider` exposing free, Pro, loading, and error states.
- Entitlement checks using the exact identifier `pro`.
- A mock package when no RevenueCat API key exists.
- RevenueCat Test Store offerings and purchases when a test key is present.
- A `/subscription` MVP screen and a `Try Pro` header entry point.
- Purchase cancellation, empty offering, refresh, and native restore behavior.
- Web-safe access refresh instead of unsupported web restore behavior.
- Separate development, iOS, Android, and web key configuration.
- A branch-specific setup guide in `docs/BILLING-MVP.md`.

The branch does not contain credentials, production pricing, authentication, backend webhooks, or final premium gates.

## Verification already completed

The RevenueCat MVP branch passed:

- Reproducible `npm ci`.
- ESLint.
- Strict TypeScript checking.
- All four Electron runtime/security tests.
- Expo Doctor: 21 of 21 checks.
- Static Expo web/Electron export.
- Generation and rendering of the `/subscription` route.
- RevenueCat Browser Mode bundling for the web target.

A live RevenueCat Test Store purchase has not been performed because a project and Test Store API key have not yet been
provided.

The dependency install reported 11 moderate npm advisories. No automatic or forceful audit fix was applied.

## RevenueCat dashboard MVP setup

1. Create a RevenueCat project.
2. Use the automatically available Test Store or create one under Apps and providers.
3. Create an entitlement with the exact identifier `pro`.
4. Create monthly and annual Test Store products.
5. Attach both products to `pro`.
6. Add both products as packages in the current offering.
7. Copy the Test Store public SDK key.
8. On `feat/revenuecat-mvp`, copy `docs/revenuecat.env.example` to `.env.local`.
9. Set `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=test_...`.
10. Restart Metro and open `/subscription` or press `Try Pro` in the app header.

Never ship a Test Store key. The implementation ignores it in release builds, but the release environment must still
provide the proper iOS, Android, and web public SDK keys.

## Integration order

1. Finish and commit the current audio work.
2. Review `feat/revenuecat-mvp` independently or merge/cherry-pick commit `7f4e966`.
3. Resolve expected overlap in `package.json`, `package-lock.json`, and `src/app/_layout.tsx` carefully.
4. Configure the RevenueCat Test Store and exercise successful, cancelled, and failed purchases.
5. Decide the actual free-versus-Pro product boundary before gating curriculum.
6. Add authentication and pass a stable internal user ID to RevenueCat.
7. Add FastAPI webhook ingestion and server-side entitlement authorization.
8. Configure and test real store products only when release work begins.

Do not gate durable learner records exclusively in the client. Do not identify RevenueCat customers by email address.
Do not add a RevenueCat secret API key to Expo environment variables.

## Production acceptance criteria

- The same authenticated learner receives the correct `pro` entitlement across every supported platform.
- Purchase success, cancellation, failure, expiration, refund, and restoration have deliberate UI behavior.
- The app remains usable in a bounded offline state when RevenueCat is temporarily unreachable.
- Premium backend operations verify access server-side.
- Webhook deliveries are authenticated, idempotent, retry-safe, and reconcilable.
- Test Store keys cannot enter release artifacts.
- Apple, Google, and web products all map to the same logical entitlement.
- Account deletion and subscription-management instructions are clear and store compliant.

## Official references

- Expo integration: https://www.revenuecat.com/docs/getting-started/installation/expo
- React Native integration: https://www.revenuecat.com/docs/getting-started/installation/reactnative
- Test Store: https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store
- Products, entitlements, and offerings: https://www.revenuecat.com/docs/projects/configuring-products
- Customer and App User IDs: https://www.revenuecat.com/docs/customers/user-ids
- CustomerInfo and subscription status: https://www.revenuecat.com/docs/customers/customer-info
- Web billing overview: https://www.revenuecat.com/docs/web/overview
- Webhooks: https://www.revenuecat.com/docs/integrations/webhooks

## Ready-to-paste implementation prompt

```text
Continue the GlideLingo RevenueCat integration using docs/REVENUECAT-CONTEXT.md as the authoritative context.

First inspect AGENTS.md, the current branch and working tree, commit 7f4e966 on feat/revenuecat-mvp, and the applicable
Expo/Electron repository skill. Preserve all unrelated user changes. Do not assume the RevenueCat MVP branch has already
been merged.

Desired outcome:
- Integrate or extend the smallest coherent RevenueCat MVP slice requested in this session.
- Keep RevenueCat responsible for purchase lifecycle and the `pro` entitlement only.
- Keep authentication, learner state, curriculum rules, and protected API authorization owned by GlideLingo.
- Preserve the Expo web boundary used by Electron.

Constraints:
- Entitlement identifier: pro.
- Use public platform SDK keys only; never expose RevenueCat secret keys.
- Development may use RevenueCat Test Store or local mock mode.
- Never ship a Test Store key.
- Use one stable internal authenticated user ID across platforms when auth exists; do not use email as identity.
- Do not trust client isPro state for protected backend operations.
- Do not implement production stores, webhooks, auth, or premium curriculum gates unless explicitly requested.
- Use npm and the committed package-lock.json.
- Verify with npm ci, npm run verify, npm run doctor for dependency/config changes, and npm run desktop:export.
- Exercise the affected runtime interaction when possible.

Before changing code, report the observed current state, branch relationship, conflicts, and exact acceptance criteria.
After changing code, inspect the complete diff and report verification evidence plus any untested RevenueCat dashboard or
store behavior.
```
