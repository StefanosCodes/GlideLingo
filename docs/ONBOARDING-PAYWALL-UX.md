# GlideLingo onboarding and paywall UX

Status: proposed product direction

Audience: product, design, engineering, and growth

Primary surface: iOS and Android, responsive to web and Electron

Initial course assumption: Modern Greek (`Greek from zero`, A0–A1)

Implementation note: the first coded slice is stacked on the Clerk/RevenueCat MVP and therefore runs after sign-in and first-name completion, when a stable billing identity exists. Moving the learning sample before authentication remains the preferred product direction, but requires a coordinated change to the authentication boundary and is not hidden inside this onboarding PR. This slice implements the full signed-in sequence and soft paywall; premium lesson gating and the mission-boundary paywall remain separate work after the free mission is complete and validated.

## Decision

Use a short, calm onboarding that moves through:

```text
promise -> relevant choices -> credible plan -> real learning sample
        -> earned result -> soft paywall -> first full mission
```

The first paywall appears only after the learner has heard Greek and completed one small check. It offers Pro clearly, but also provides a visible route into one complete free mission. The stronger contextual paywall appears at the boundary between the completed free mission and the next locked mission.

This is not a long personality quiz, a fake plan generator, or a hard paywall immediately after install.

## Why this fits GlideLingo

- The learner sees a real course and real Greek before seeing a price.
- The sequence creates **calm momentum**: uncertain -> oriented -> capable -> ready to choose.
- Personalization is limited to choices that change the experience.
- Progress language remains truthful. A sample can show that the learner recognized a sound; it cannot claim fluency or mastery.
- The paywall sells continued access to meaningful learning, not relief from pressure.
- The visual treatment stays within GlideLingo's compact Inter, Zinc, hairline, semantic-token system.

## Experience contract

### Learner outcome

The learner understands what GlideLingo teaches, experiences one real instructional interaction, and knows their next useful action.

### Target behavior

Complete the sample and make an informed choice between starting Pro and continuing into the free first mission.

### Business outcome

Convert high-intent learners without hiding price, manufacturing urgency, or degrading the free experience.

### Emotional transition

```text
"Is this for me?" -> "This path fits me" -> "I can do this" -> "I know what I am buying"
```

### Explicit non-goals

- Do not ask questions whose answers do not change copy, sequencing, reminders, or placement.
- Do not request notification, microphone, tracking, or contacts permission during the introductory questionnaire.
- Do not show unavailable languages as selectable onboarding options.
- Do not promise pronunciation scoring, adaptive review, tutoring, or cross-device sync until those capabilities ship.
- Do not use countdown timers, preselected consent, fake discounts, hidden free paths, or guilt copy.

## Sequence at a glance

| Step | Screen | Learner question | Primary action | Product job |
| --- | --- | --- | --- | --- |
| 0 | Launch decision | Am I new or returning? | Automatic routing | Avoid repeating onboarding |
| 1 | Welcome | Is this the kind of Greek learning I want? | Build my path | Establish a concrete promise |
| 2 | Goal | Where do I want Greek to take me? | Continue | Pin a meaningful destination |
| 3 | Starting point | Where should I begin? | Continue | Select start or offer a check |
| 4 | Rhythm | What pace is realistic for me? | Continue | Set a learner-owned cadence |
| 5 | Plan reveal | What will I do first? | Try the first sound | Make the path credible |
| 6 | Learning sample | Can I make sense of a Greek sound? | Check answer | Demonstrate the learning loop |
| 7 | Earned result | What did I just do? | See my options | Name a truthful micro-win |
| 8 | Soft paywall | How do I want to continue? | Start trial | Present Pro and the free route |
| 9 | Today | What should I do now? | Start first lesson | Begin the real free or Pro path |

## Full branch model

```text
APP LAUNCH
   |
   +-- returning learner + valid local/session state ------> TODAY
   |
   +-- returning learner chooses sign in -----------------> SIGN IN -> TODAY
   |
   `-- new learner
          |
       WELCOME
          |
        GOAL
          |
    STARTING POINT
          |
        RHYTHM
          |
      PLAN REVEAL
          |
    LEARNING SAMPLE
          |
     EARNED RESULT
          |
      SOFT PAYWALL
       /    |      \
      /     |       `-- restore purchase -> entitlement refresh
     /      |
 PRO CTA   CONTINUE FREE
    |           |
 auth*       TODAY: free mission
    |           |
 purchase      `-- finish free mission -> CONTEXTUAL PAYWALL
    |
 success -> TODAY: Pro

* Only if stable account identity is required and is not already present.
```

Purchase cancellation returns to the same paywall with the selected package preserved. A purchase error stays in place and offers retry. Neither is treated as learner failure.

---

## Shared onboarding frame

Every questionnaire screen uses one shell rather than inventing a layout per step.

```text
┌──────────────────────────────────────┐
│  Back                 Step 2 of 3    │
│  [===========-------------------]    │
│                                      │
│  QUESTION                            │ eyebrow, optional
│  Where do you want Greek             │ display
│  to take you?                        │
│                                      │
│  This helps us keep your first       │ body / textSecondary
│  milestone relevant.                 │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Travel with more confidence  ✓ │  │ choice row
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Speak with family              │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Build everyday conversation    │  │
│  └────────────────────────────────┘  │
│                                      │
│  [            Continue            ]  │ sticky primary action
└──────────────────────────────────────┘
```

### Design-system recipe

| Element | Existing GlideLingo language |
| --- | --- |
| Canvas | `theme.background`; no decorative background blobs |
| Content width | Mobile gutters using `Spacing.three`; centered column, max 480pt on larger screens |
| Question | `ThemedText type="display"` |
| Supporting copy | `ThemedText type="body" themeColor="textSecondary"` |
| Choices | Flat `GlideSurface` or a dedicated choice-row primitive using `theme.border` |
| Selected choice | Border plus check symbol and semantic selected fill; never color alone |
| Primary action | Full-width `GlideButton`, primary black/white treatment |
| Secondary action | Text action, visually quiet but readable |
| Progress | Thin `ProgressBar`; questionnaire steps only, not welcome/sample/paywall |
| Motion | 140–220ms opacity/position transition; no looping decoration |

If the pending calm-momentum light-blue accent is merged, use it only for the selected/next-useful state and the plan reveal. Do not introduce new local hex values in onboarding.

On tablet, web, and Electron, keep onboarding as a centered reading column on the application canvas. Do not show the application sidebar until the learner reaches Today.

---

## Screen 1 — Welcome

### Purpose

Make the product promise concrete without asking for commitment yet.

### Candidate copy

- Eyebrow: `MODERN GREEK · REAL-WORLD MISSIONS`
- Heading: `Learn the Greek you'll actually use.`
- Body: `Short guided lessons take you from the alphabet to first conversations.`
- Primary CTA: `Build my path`
- Secondary CTA: `I already have an account`

### Wireframe

```text
┌──────────────────────────────────────┐
│                                      │
│          [GlideLingo mark]           │
│                                      │
│  MODERN GREEK · REAL-WORLD MISSIONS  │
│  Learn the Greek you'll              │
│  actually use.                       │
│                                      │
│  Short guided lessons take you       │
│  from the alphabet to first          │
│  conversations.                      │
│                                      │
│  The sound of Greek       8 min      │ subtle preview row
│  Introduce yourself       next       │
│  Order at a café          ahead      │
│                                      │
│  [          Build my path          ] │
│       I already have an account      │
└──────────────────────────────────────┘
```

Use the existing brand mark as identification, not as a talking mascot. The course preview rows provide visual interest through real content.

---

## Screen 2 — Goal

### Purpose

Let the learner choose a destination that will remain visible in their plan. The authored prerequisite path does not silently change, but the chosen mission can be pinned as a meaningful destination.

### Candidate choices

- `Travel with more confidence`
- `Speak with family or friends`
- `Handle everyday conversations`
- `Build a strong foundation`

### Behavior

- One selection is required.
- The selected goal changes the plan reveal and later milestone copy.
- The goal remains editable from Profile.
- If the application cannot persist or use the answer, omit this screen from the MVP.

### Copy example after selection

`We'll build the foundations first, then guide you toward travel exchanges.`

---

## Screen 3 — Starting point

### Purpose

Avoid forcing every learner through the alphabet while also avoiding an unsafe skip based only on confidence.

### Candidate choices

- `I'm starting from zero` — begin with `The sound of Greek`
- `I know some Greek letters` — offer a short starting check
- `I can manage a few basics` — offer a short starting check

### Wireframe

```text
┌──────────────────────────────────────┐
│  Back                 Step 2 of 3    │
│  [====================----------]    │
│                                      │
│  Where are you starting?             │
│  You can change this later.          │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ From zero                     │  │
│  │ Start with Greek sounds       │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ I know some Greek letters     │  │
│  │ Take a short starting check   │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ I can manage a few basics     │  │
│  │ Take a short starting check   │  │
│  └────────────────────────────────┘  │
│                                      │
│  [            Continue            ]  │
└──────────────────────────────────────┘
```

### Integrity rule

Do not claim a proficiency level from one self-report. A starting check may recommend where to begin, but the learner can choose an earlier point. If placement has not been implemented and validated, launch with `From zero` and remove this screen.

---

## Screen 4 — Rhythm

### Purpose

Turn vague motivation into a realistic learner-owned cadence. This is a planning preference, not evidence of commitment or ability.

### Candidate choices

- `3 days a week` — recommended starting rhythm
- `5 days a week`
- `Every day`
- `I'll decide as I go`

### Candidate copy

- Heading: `What rhythm feels realistic?`
- Body: `Most lessons take 8–12 focused minutes. Missing a day never removes what you've completed.`

### Behavior

- Save the choice as a weekly target, not a punitive streak.
- Do not ask for notification permission here.
- After the learner completes a real lesson, they may optionally choose reminder days and time; only then request operating-system permission.

---

## Screen 5 — Plan reveal

### Purpose

Transform answers into a credible route. Show authored milestones rather than a fake generated loading sequence or an ungrounded “fluent in 12 weeks” promise.

### Candidate copy for a new travel learner

- Eyebrow: `YOUR GREEK PATH`
- Heading: `Start with the sounds. Build toward real exchanges.`
- Body: `Three focused sessions a week, beginning with an 8-minute lesson.`

### Wireframe

```text
┌──────────────────────────────────────┐
│  YOUR GREEK PATH                     │
│  Start with the sounds.              │
│  Build toward real exchanges.        │
│                                      │
│  NOW                                 │
│  01  Decode Greek letters            │
│      First lesson · 8 min             │
│   │                                  │
│  NEXT                                │
│  02  Introduce yourself              │
│   │                                  │
│  YOUR DESTINATION                    │
│  03  Handle a travel exchange        │
│                                      │
│  [       Try the first sound       ] │
│             Edit my answers           │
└──────────────────────────────────────┘
```

This is the only onboarding screen that may receive the quiet next-action wash if that semantic design-system treatment is available. The path remains typographic and line-based, not a game board.

---

## Screen 6 — Learning sample

### Purpose

Demonstrate the actual learning interaction using shipped course content and bundled audio. This sample is not a marketing animation.

### Recommended 30–60 second sequence

1. Hear `α · Α` with the bundled `el-letter-alpha` audio.
2. Read `like the a in father`.
3. Replay if desired.
4. Answer `Which letter is the a in father?` from `α`, `ε`, and `ι`.
5. Receive immediate informational feedback.

### Active state

```text
┌──────────────────────────────────────┐
│  Close                               │
│                                      │
│  FIRST SOUND                         │
│                                      │
│                 α                    │
│                                      │
│        like the a in father          │
│             [ Play again ]           │
│                                      │
│  Which letter is the a in father?    │
│                                      │
│       [ α ]      [ ε ]      [ ι ]    │
│                                      │
│  [          Check answer           ] │
└──────────────────────────────────────┘
```

### Feedback states

Correct:

```text
α maps to a sound you already know.
[ Continue ]
```

Incorrect:

```text
ε sounds like the e in red. The a in father is α.
[ Hear both ]  [ Try again ]
```

Audio loading, unavailable audio, interruption, and replay must remain within this screen. If audio fails, show the written sound comparison and allow the learner to continue; do not trap onboarding on a network or device failure.

---

## Screen 7 — Earned result

### Purpose

Make the small learning truth visible without inflating it into mastery.

### Candidate copy

- Eyebrow: `FIRST CONNECTION`
- Heading: `You mapped α to a familiar sound.`
- Body: `The first lesson builds this into words like καλημέρα.`
- Primary CTA: `See my options`

Do not use `You learned Greek`, `Mastered`, a proficiency percentage, confetti, XP, or an invented streak. A small 220ms state settle is enough.

---

## Screen 8 — Soft paywall

### Purpose

Connect payment directly to continuing the course while preserving an understandable free path.

### Recommended offer model

- Default emphasized package: annual Pro with a clearly stated trial, if a trial is configured.
- Alternative: monthly Pro for flexibility.
- Free route: one complete authored mission, not a crippled demo and not an unlimited promise.
- Do not offer weekly pricing at launch.
- Do not offer lifetime access until content scope, support cost, and long-term economics are understood.

### Wireframe

```text
┌──────────────────────────────────────┐
│  Close                    Restore    │
│                                      │
│  KEEP YOUR GREEK MOVING              │
│  Continue your complete              │
│  guided path.                        │
│                                      │
│  ✓ Complete Greek course             │
│  ✓ Short guided listening lessons    │
│  ✓ Progress and review*               │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Annual Pro             BEST FIT│  │
│  │ [localized price] / year       │  │
│  │ [trial terms, if configured]   │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Monthly Pro                    │  │
│  │ [localized price] / month      │  │
│  └────────────────────────────────┘  │
│                                      │
│  [       Start free trial**        ] │
│                                      │
│  Continue with the free first mission│
│                                      │
│  Auto-renewal terms · Terms · Privacy│
└──────────────────────────────────────┘

* Show only when real progress/review functionality ships.
** Button copy must match the selected package and actual offering.
```

### Paywall hierarchy

1. The continuation promise.
2. Three or four benefits that exist in the shipping product.
3. Store-fetched localized packages and billing periods.
4. An explicit primary purchase action.
5. A visible free route.
6. Restore, terms, privacy, renewal, and cancellation information.

### Required behavior

- No package is shown until offerings finish loading.
- If offerings are empty or fail, preserve the free route and provide `Try again`.
- Disable duplicate purchase taps while a purchase is processing.
- Cancellation returns to the idle paywall without a red error.
- A real error explains that no charge was completed and offers retry.
- Restore has loading, restored, nothing-to-restore, and error states.
- Entitlement, not the purchase callback alone, determines Pro access.
- Screen readers announce selected package, price, billing period, trial, and renewal terms as one understandable unit.

### Copy integrity

Use exact localized store prices. If showing an equivalent monthly amount for an annual product, also state that it is billed annually. Never place `cancel anytime` where cancellation mechanics or trial conversion terms are not immediately understandable.

---

## Screen 9 — Today handoff

### Purpose

End onboarding inside the real product with one obvious learning action.

### Pro entry

- Heading: `Your first Greek lesson is ready.`
- Current quest: `The sound of Greek · 8 min`
- CTA: `Start lesson`
- Entitlement is active and the full path is visible.

### Free entry

- Same heading, quest, and first CTA.
- The complete first mission is available.
- Later missions may be visible as future outcomes, with their locked state explained plainly.
- Do not show an upsell banner above the first learning action.

The learner should not land on an empty dashboard, profile form, notification request, or second paywall.

---

## Free-to-paid conversion moments

The onboarding paywall is only the first offer. Repetition should be limited and contextual.

### 1. Soft onboarding offer

Timing: after the real sample.

Free response: `Continue with the free first mission`.

Purpose: convert high-intent learners without blocking evaluation.

### 2. Contextual mission-boundary paywall

Timing: after the learner finishes the free mission and sees what changed.

Recommended copy:

```text
YOU COMPLETED YOUR FIRST MISSION
You can recognize core Greek letters and sound patterns.

Next: introduce yourself in Greek.

[ Start Pro trial ]
  Not now
```

This is the strongest conversion moment because it follows actual effort and points to a concrete next capability. The completion message must appear before the commercial offer; payment must not swallow the achievement.

### 3. Learner-initiated Pro entry

Timing: Profile or a clearly locked premium capability.

Purpose: let learners reconsider without repeated interruption.

### Frequency guardrail

After a free learner dismisses the mission-boundary paywall, do not interrupt every app launch. Keep the locked next mission and Profile entry visible, and wait for a learner-initiated action or a meaningfully new offer.

## Free and Pro product boundary

Recommended starting boundary:

| Free | Pro |
| --- | --- |
| Onboarding learning sample | Everything in Free |
| One complete authored mission | Complete published course path |
| Replay bundled audio in that mission | Full listening and practice catalog |
| Honest path and mission progress | Paid tutor/review features only when shipped |
| Local progress where supported | Cross-device sync only when authenticated persistence ships |

The free boundary should be expressed as access to a coherent learning outcome, not an arbitrary daily frustration cap. If the first complete mission is not authored and usable end to end, GlideLingo is not ready to place the paid gate after it.

## Account and identity timing

- Welcome always exposes `I already have an account` for returning learners.
- New learners can complete the questionnaire and sample without an account.
- If purchase or protected paid functionality requires a stable account, ask for authentication after the learner taps the Pro CTA, then resume the selected purchase automatically.
- The free route should not unexpectedly become a mandatory account wall unless durable progress genuinely requires it and the copy explains why.
- RevenueCat entitlement identity and GlideLingo account identity must converge on a stable internal learner ID. A client boolean such as `isPro` is not authorization.

## Persistence and resumption

Persist after every consequential step:

- onboarding version;
- completed step;
- selected goal;
- selected starting point or placement result;
- selected cadence;
- sample completion state;
- paywall dismissal/completion state;
- authenticated account ID when available.

On interruption, resume at the first incomplete meaningful step. Do not force a learner to replay completed questions or the audio sample. If the onboarding schema changes later, migrate known values and ask only newly necessary questions.

## Accessibility and responsive behavior

- Support Dynamic Type without clipping the question, choices, prices, or CTA.
- Maintain 44–48pt touch targets for choice rows and primary actions.
- Preserve selection using checkmarks and accessible state, not color alone.
- Provide reduced-motion parity; all transitions may become instant fades.
- Audio controls need clear play, playing, replay, and unavailable labels.
- Do not auto-play audio when a screen opens.
- Keep purchase/legal copy readable and reachable without requiring precision scrolling.
- In landscape or desktop layouts, retain the same reading order and centered column.
- Keyboard and screen-reader focus moves to the new heading after each navigation.

## Measurement plan

### Funnel events

```text
onboarding_started
onboarding_goal_selected
onboarding_starting_point_selected
onboarding_rhythm_selected
onboarding_plan_viewed
onboarding_sample_started
onboarding_sample_answered
onboarding_sample_completed
paywall_viewed
paywall_package_selected
purchase_started
purchase_completed
purchase_cancelled
purchase_failed
restore_started
restore_completed
free_path_selected
first_lesson_started
first_mission_completed
mission_boundary_paywall_viewed
```

Event properties should use stable option identifiers, onboarding/paywall version, platform, offering identifier, package identifier, and entitlement outcome. Do not send raw learner speech, sensitive text, store credentials, or unnecessary personal information.

### Primary behavior metric

Percentage of new learners who start the first real lesson after onboarding.

### Primary commercial metric

Trial or purchase activation among eligible new learners, reported alongside refund and early-cancellation rates.

### Learning metric

First-mission completion and later retrieval performance. Purchase conversion alone is not proof that onboarding improved learning.

### Guardrails

- onboarding abandonment by screen;
- sample audio/error rate;
- free-path visibility and selection;
- purchase cancellation and failure rate;
- restore success rate;
- refund and early-cancellation rate;
- support contacts about price or renewal confusion;
- accessibility defects;
- first-week meaningful practice, not raw app opens.

## Implementation slices

### Slice 1 — Clickable sequence with mock billing

- Build the shared onboarding frame and screen transitions.
- Use the real bundled Greek audio and first check.
- Use a deterministic mock offering and entitlement.
- Persist and resume onboarding locally.
- Verify every branch without a live store purchase.

Success: a new learner can complete, interrupt/resume, choose Pro or Free, and reach the correct Today state.

### Slice 2 — Stable identity and durable learner state

- Connect onboarding state to the authenticated learner contract.
- Preserve the returning-user route.
- Define anonymous-to-authenticated state migration.
- Confirm cross-platform entitlement identity.

Success: onboarding choices, learning progress, and Pro access survive reinstall/sign-in according to the supported product contract.

### Slice 3 — Store-backed paywall

- Load localized RevenueCat offerings.
- Implement purchase, cancellation, restore, empty-offering, retry, and entitlement refresh behavior.
- Validate store-compliant package and renewal copy per platform.

Success: sandbox/Test Store purchase and restore pass on supported platforms, and server-protected paid behavior does not trust client entitlement state alone.

### Slice 4 — Contextual mission-boundary conversion

- Confirm one complete authored free mission exists.
- Show earned capability closure first.
- Present the locked next mission and contextual Pro offer.
- Add frequency caps and learner-initiated re-entry.

Success: free learners retain access to completed work, see the next concrete capability, and are not repeatedly interrupted after dismissing the offer.

## Acceptance criteria

- A new learner sees real Greek before any price.
- Every asked question has an observable downstream effect.
- The sample uses real course content and works without microphone permission.
- Correct and incorrect sample answers both have dignified continuation paths.
- Pro pricing and trial terms come from the active store offering.
- Free continuation is visible and leads to a coherent mission.
- Returning users can sign in or restore access without repeating onboarding.
- Purchase cancellation and failure do not lose onboarding state.
- The application never labels onboarding interaction as mastery or fluency.
- The full sequence works with Dynamic Type, screen reader, reduced motion, dark mode, offline/interrupted audio, and narrow screens.

## Open product decisions

1. **Riskiest assumption:** one complete free mission gives enough value to support both trust and conversion. Validate this before optimizing paywall styling.
2. Decide which Pro benefits will actually ship at launch; the paywall must list only those.
3. Decide annual/monthly products, localized prices, trial eligibility, and trial duration in the store and RevenueCat configuration.
4. Decide whether starting-point checks exist at launch. If not, remove that screen.
5. Decide whether a stable account is mandatory before purchase or only before protected/synced paid use.
6. Decide the exact free mission after one end-to-end authored learning loop is validated.

## Deliberately plain

- Welcome remains a clean promise and course preview, not a cinematic ad.
- Questionnaire choices remain neutral rows, not collectible cards.
- The sample uses the lesson's actual interaction language.
- Correct feedback is small and specific.
- The paywall is transparent commerce, not a celebration screen.
- Today remains focused on the next lesson rather than subscription status.

The learner truth this design makes visible is simple: **you made one real connection in Greek, and there is a clear path to make the next one.**
