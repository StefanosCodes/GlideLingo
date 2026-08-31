# RevenueCat billing MVP

This slice establishes an account-scoped client subscription boundary without committing store credentials, prices, or
premium curriculum rules. Clerk owns authentication. RevenueCat owns purchases and the exact `pro` entitlement. Do not
enable Clerk Billing for the same subscription.

## Integration contract

- Mount `BillingProvider` inside `ClerkProvider` and pass `userId={userId}` from Clerk's `useAuth()` result.
- Keep the provider mounted while Clerk finishes sign-out so it can detach the RevenueCat identity. It also clears visible
  entitlement state synchronously when the `userId` prop changes.
- Identity changes, offering loads, purchases, and restores share one serialized queue so a purchase cannot finish under a
  different Clerk account during rapid sign-out or account switching.
- Never pass an email address or phone number as the RevenueCat App User ID.
- Register the `/subscription` route inside the authenticated Expo Router boundary and add the desired in-app entry point.
- The client entitlement makes the UI responsive. A future paid API operation must verify access independently in FastAPI;
  it must never trust a client `isPro` boolean.

## Public client configuration

Use public SDK keys only. Local development can place these variables in the ignored root `.env`; EAS/release environments
must inject the appropriate release values.

```dotenv
EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_WEB_API_KEY=
```

The Test Store key overrides platform keys only in development. Release builds ignore it. Never expose a RevenueCat secret
API key through `EXPO_PUBLIC_*`.

## RevenueCat dashboard setup

1. Create the entitlement with the exact identifier `pro`.
2. In the Test Store, create one monthly and one annual product.
3. Attach both products to `pro`.
4. Add monthly and annual packages to the current offering.
5. Add the Test Store public SDK key locally and restart Metro.
6. Sign in through Clerk, open `/subscription`, and test success, cancellation, failure, refresh, and sign-out/account switch.

Without a public SDK key, the screen uses an in-memory mock package scoped to the current signed-in account. Real native
purchases require an Expo development build; Expo Go is preview-only for this integration.

## Platform behavior

- iOS and Android use their separate public SDK keys and native purchase/restore flows.
- Browser and Electron use the web key. Electron follows the web path because it packages the Expo web bundle.
- Web refreshes CustomerInfo rather than invoking the native restore API.
- Every platform uses the same authenticated Clerk user ID so a single RevenueCat customer receives the same `pro`
  entitlement across devices.

## Deferred production work

- Apple App Store, Google Play, and web billing products and prices.
- RevenueCat webhooks, server-owned entitlement persistence, reconciliation, and paid API authorization.
- Premium feature gates, remote paywalls, Customer Center, analytics, trials, and launch copy.
- Account deletion and subscription-management policy/copy required for store release.

Before release, verify the Test Store key is absent, exercise every shipping platform in its real store sandbox, and add
server-owned authorization before protecting an API capability.
