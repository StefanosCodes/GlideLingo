# Product analytics

## Outcome and boundary

GlideLingo uses PostHog for best-effort behavioral analytics while keeping the vendor behind the typed client boundary in `src/features/analytics`. PostgreSQL remains authoritative for learning state, the backend and RevenueCat remain authoritative for subscriptions, and billing or affiliate ledgers remain authoritative for money and attribution. Analytics data never grants access, changes product state, or proves a financial outcome.

This foundation instruments only semantic screen sessions, foreground-active duration, and Clerk identity transitions. The broader event contract is defined now so later feature branches integrate against one reviewed privacy boundary. Course, lesson, voice, onboarding, paywall, subscription, affiliate, acquisition-website, experimentation, and replay callsites are deliberately deferred under the gates below.

## Architecture and ownership

```text
feature or root observer
  -> typed AnalyticsClient.capture(name, properties)
  -> exact event-specific runtime allowlist
  -> controlled environment/platform/version context
  -> no-op adapter (local, test, missing, or invalid configuration)
     OR PostHog adapter (preview, staging, production)
```

- Product Engineering owns event meaning, property schemas, semantic surface names, identity transitions, and tests.
- Privacy review owns any expansion to collected properties, autocapture, session replay, surveys, or external website acquisition tracking.
- Release owners provision environment-specific public PostHog project tokens and verify the selected project. This repository does not create or mutate a PostHog project.
- Feature owners add instrumentation only after the corresponding product behavior and source-of-truth contract are stable.
- PostHog owns ingestion, batching, queues, funnels, cohorts, dashboards, and future experimentation. GlideLingo does not recreate those systems.

The native adapter uses `posthog-react-native@4.66.3`; web and Electron use `posthog-js@1.427.1`. Across the applicable runtimes, the adapters disable automatic screen, lifecycle, touch, page-view, dead-click, exception, performance, heatmap, survey, replay, and remote feature-flag collection. Native events use the SDK's bounded in-memory queue (`flushAt: 20`, ten-second interval, maximum 1,000 queued messages); memory-only persistence prevents a queued preview identity or event from crossing into production when builds share a bundle identifier. Web/Electron use request batching. Feature interaction handlers never await or flush analytics.

## Event and schema policy

Event names are stable, lowercase past-tense actions. Do not create an event per course, lesson, screen instance, or button. IDs and bounded enums belong in properties. Feature code may send only the properties declared for that event; the runtime rejects unknown names, unknown properties, prohibited property names, malformed IDs, invalid enum values, and out-of-budget numbers before an adapter sees them.

Every accepted payload includes `schema_version`, `analytics_environment`, `runtime_surface`, and `app_version`. Additive optional properties may retain the current schema version after dashboard consumers are checked. Renaming an event/property, changing meaning or units, narrowing a valid domain, or changing requiredness is breaking: add a new event or increment the schema version, run old and new forms for a documented migration window when necessary, update dashboards, then retire the old form. Never silently reuse a name for a new meaning.

Initial catalog:

| Event | Required meaning | Safe properties | Current state |
| --- | --- | --- | --- |
| `screen_viewed` | A semantic surface became visible while foregrounded | surface, entry reason | Instrumented |
| `screen_exited` | A visible surface ended, the app left foreground, or authenticated ownership changed | surface, exit reason, foreground-active milliseconds | Instrumented |
| `course_previewed` | Learner viewed a stable course preview | course ID, language ID | Contract only; gated on #59 |
| `course_started` | Learner deliberately enrolled in a course | course ID, language ID | Contract only; gated on #59 |
| `lesson_started` | A stable lesson session began | course ID, lesson ID, learn/review mode | Contract only; gated on #59 |
| `lesson_beat_viewed` | The learner reached a semantic lesson beat | lesson ID, mode, zero-based index, beat type | Contract only; gated on #59 |
| `pronunciation_requested` | Playback was requested | audio asset ID, safe source, repeat flag, optional lesson/index | Contract only; gated on #59/#57 |
| `pronunciation_failed` | Playback failed | audio asset ID, safe source, coarse failure kind, optional lesson/index | Contract only; gated on #59/#57 |
| `answer_submitted` | An answer attempt was evaluated | lesson ID, mode, beat index, attempt number, correct/incorrect | Contract only; gated on #59 |
| `lesson_tutor_opened` | Tutor UI was opened | lesson ID, beat index | Contract only; gated on #59 and tutor stabilization |
| `lesson_exited` | Learner left or completed a lesson | lesson ID, mode, beat index, coarse exit reason | Contract only; gated on #59 |
| `lesson_completed` | The deterministic lesson completion transition occurred | lesson ID, mode, beat/attempt counts, recovery flag | Contract only; gated on #59 |

Manual Expo Router tracking maps paths to stable semantic surfaces. It never sends raw paths, route parameters, query strings, fragments, referrers, or URLs. The web/Electron lesson overlay overrides `/` from `home` to `lesson`. Duplicate route/AppState signals do not create duplicate semantic transitions, and background time is excluded from active duration.

The browser adapter also disables referrer/campaign persistence, applies a final pre-send sanitizer that removes URL/path/query/referrer/campaign/person-property enrichment added by the SDK, removes raw user-agent strings, and disables GeoIP enrichment on captured events. These vendor controls are defense in depth after GlideLingo's own exact property allowlist.

## Privacy invariants

The following are prohibited in analytics event properties or identity:

- email, name, phone number, or other direct profile fields;
- raw answers, selected choices, arbitrary learner text, tutor messages, prompts, responses, or transcripts;
- recordings, audio content, payment/card details, access tokens, authentication callbacks, or vendor secrets;
- unrestricted routes, URLs, queries, fragments, request/response bodies, or error messages.

Clerk's opaque stable `userId` is the only authenticated analytics identity. Email is never used. The first resolved Clerk state clears any persisted SDK identity before remaining anonymous or identifying the current user, preventing a prior account from leaking across a cold start. Anonymous activity created after that boundary remains anonymous until a verified Clerk identity appears; PostHog `identify` then connects that same-session anonymous history. Logout resets identity once after Clerk reports the signed-out transition. An account switch closes the current screen segment and resets before identifying the next user so two accounts cannot share an analytics identity or duration segment.

Blanket touch autocapture and session replay are off. Enabling either, adding user-level properties, or adding sampled replay requires a separate privacy review, consent/notice decision, masking verification on every target, retention policy, deletion/export procedure, and a dedicated PR.

## Environment matrix

| Runtime | Configuration | External traffic | Project rule |
| --- | --- | --- | --- |
| Jest/test | Forced disabled | None; PostHog adapter is not constructed | No project |
| Local Expo, web, or Electron (`__DEV__`) | Forced disabled even if variables exist | None; PostHog adapter is not constructed | No project |
| Missing or invalid configuration | Disabled without throwing | None; PostHog adapter is not constructed | No project |
| Preview | `EXPO_PUBLIC_ANALYTICS_ENVIRONMENT=preview` plus valid public token/host | Batched best effort | Non-production project |
| Staging | `EXPO_PUBLIC_ANALYTICS_ENVIRONMENT=staging` plus valid public token/host | Batched best effort | Non-production project, separate from production |
| Production | `EXPO_PUBLIC_ANALYTICS_ENVIRONMENT=production` plus valid public token/host | Batched best effort | Dedicated production project |

Supported ingestion origins are exactly `https://us.i.posthog.com` and `https://eu.i.posthog.com`; Electron's packaged CSP permits only those exact PostHog origins and the existing application dependencies. `EXPO_PUBLIC_POSTHOG_API_KEY` must be a PostHog public project token (`phc_...`). All `EXPO_PUBLIC_*` values are embedded in the client and are not secrets. Personal API keys, ingestion secrets, CI credentials, and server keys must never use this prefix or enter the client bundle.

No build profile or release workflow is activated by this foundation. Provisioning distinct PostHog projects and adding their public values to the relevant EAS/CI release boundary is an external configuration action requiring separate authorization and acceptance evidence. Until then, missing configuration keeps every target operational with analytics disabled.

## Operational and performance budgets

- Analytics initialization, capture, identify, reset, persistence, and transport failures must never block or throw into rendering, navigation, authentication, playback, lesson completion, or purchase flows.
- Capture performs bounded validation and queue insertion only. No interaction handler waits for network I/O and no event forces a network flush.
- Native batches at 20 events or ten seconds and caps its memory-only queue at 1,000. Native and browser delivery are best effort; no cross-restart offline-delivery guarantee is claimed.
- Active duration is integer milliseconds, excludes background time, and is capped at 24 hours per screen segment to bound corrupted clocks.
- Event properties remain flat, enumerated, and small; arbitrary blobs, arrays, text, device fingerprints, and payload mirrors are forbidden.
- Analytics must add no backend transaction, database write, worker, ingestion queue, or retry system.
- Monitor client initialization/capture errors through existing safe diagnostics before considering a dedicated aggregate metric; never log event payloads or identity.

## Required dashboards and funnels

Create dashboards only after the corresponding event set is enabled and quality-checked in its non-production project:

1. Navigation and engagement: semantic surface entries/exits, foreground-active duration, platform, app version, and release environment.
2. Activation: account creation/onboarding completion to course preview, course start, first lesson start, first answer, and first completion.
3. Learning journey: course and lesson progression, beat-level abandonment, attempts, recovery, completion, pronunciation requests/repeats/failures.
4. Tutor and voice: safe opens/starts/outcomes/latency buckets with no text, transcript, prompt, response, or recording.
5. Paywall and subscription: paywall view/selection and trusted server-owned purchase/renewal/cancellation outcomes, explicitly separated from client intent.
6. Acquisition and affiliate: trusted opaque attribution IDs and server/ledger outcomes, never raw query parameters or financial details.
7. Release quality: event volume, failure/abandonment shifts, and behavior segmented by `runtime_surface` and `app_version`.

## Deferred integrations and merge-order gates

Dependency snapshot: 2026-09-04 at `origin/main` `f9de28c922cbfb6ec690a195da5e3081e99df3b3`.

| Deferred event set | Owning subsystem/source of truth | Prerequisite | Merge-ready condition |
| --- | --- | --- | --- |
| Course preview/start; lesson start/beat/attempt/exit/completion; lesson pronunciation/tutor opens | Course/learning UI; PostgreSQL remains future durable learning authority | PR #59, `feat(course): deliver deterministic Course MVP` | Resolve its current conflicts, merge to current main, confirm semantic course/lesson/beat IDs, then add one focused follow-on from refreshed main |
| Realtime voice usage/outcome/latency buckets | Voice client plus authenticated backend/private tutor; never transcript/audio | PR #57, `Direct OpenAI Realtime voice practice, disabled by default` | Merge after review and activation contracts stabilize; keep flags off; instrument only coarse safe outcomes in a refreshed branch |
| Affiliate acquisition/attribution outcomes | Affiliate backend and dormant commission ledger | PR #56, `Affiliate MVP: secure referral attribution and dormant commission ledger` | Resolve conflicts and migration/ownership order; use opaque attribution and trusted backend/ledger outcomes after merge |
| Onboarding and paywall funnel | Onboarding/paywall state machine | Local-only stale `feat/onboarding-paywall-ux` has no PR and is 167 commits behind this snapshot | Rebuild as a clean current-main PR, review semantics/privacy, merge, then instrument stable transitions |
| Subscription purchase/renewal/cancel/refund | RevenueCat plus backend entitlement/webhook reconciliation | RevenueCat foundation is on main; durable billing intake draft #49 is superseded by #56 | Choose one server-owned deduplication/event owner, prove webhook/reconcile ordering, then emit trusted outcomes; client CustomerInfo alone is not authoritative |
| Website acquisition | Website referral/session contract; billing/affiliate ledger for trusted outcomes | #56 plus separate website CSP/privacy work | Replace current `connect-src 'none'` only in a dedicated reviewed PR; never forward raw query parameters |
| Session replay | Privacy/consent/retention program | None; intentionally separate | Complete privacy review, consent/notice, masking, retention, deletion/export, sampling, performance, and all-target acceptance before enabling |

Recommended order:

1. Merge this foundation first. It is independent of the unmerged product branches.
2. If #57 lands first, refresh this branch and rerun all checks because `.env.example` and package metadata overlap. If this foundation lands first, refresh #57 for the same reason.
3. Refresh #59 and #56 onto the new main one at a time. Both currently conflict with main and overlap root layout/package files; rerun current-head CI after each refresh. Course-first is a reasonable product order, but a merge rehearsal owns the final decision.
4. Add learning, voice, affiliate, and onboarding/paywall analytics as separate post-merge follow-ons owned by those subsystems. Do not copy their unmerged implementations into this branch.
5. Do not merge superseded course (#31/#50), voice (#30/#52), affiliate (#36/#42/#47/#49), or historical local billing stacks as analytics prerequisites.

## Verification and activation checklist

- `npm run test:analytics` passes the focused contract/privacy/config/identity/screen/foreground and adapter-policy tests.
- `npm run verify`, `npm run doctor`, `npm run test:desktop`, and `npm run desktop:export` pass.
- Local/test disabled paths prove the PostHog adapter factory is never called.
- Preview/staging smoke uses a non-production project and confirms only allowlisted events/properties arrive.
- Native iOS and Android runtime smoke proves startup, navigation, background/foreground, login, account switch, and logout remain non-blocking.
- Electron packaged smoke confirms the exact configured ingestion origin passes CSP without widening to wildcard PostHog origins.
- The final client bundle contains only public project configuration and no personal/server/CI secret.
- Production remains disabled until a separately authorized project, configuration, privacy notice, and release acceptance gate are complete.

Official implementation references: [PostHog React Native](https://posthog.com/docs/libraries/react-native), [PostHog browser configuration](https://posthog.com/docs/libraries/js/config), [Expo Router screen tracking](https://docs.expo.dev/router/reference/screen-tracking/), and [React Native 0.86 AppState](https://reactnative.dev/docs/0.86/appstate).
