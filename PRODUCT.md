# GlideLingo Product Requirements

**Document status:** Canonical V1 product contract  
**Target branch:** `main`  
**Last audited against `main`:** 2026-09-02  
**Audience:** Product, design, engineering, curriculum, QA, and AI agents

This is the only V1 product document. It defines what GlideLingo is, how the complete product works,
and the acceptance criteria for V1. It is a target contract, not a claim that every requirement is
already implemented.

When documents conflict, use this order:

1. This file owns product scope, navigation, feature behavior, and release requirements.
2. [`docs/learning/LEARNING-STANDARD.md`](docs/learning/LEARNING-STANDARD.md) owns evidence, pedagogy, and mastery claims.
3. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) owns visual tokens and component styling.
4. [`docs/voice/VOICE-AVATAR-PLATFORM.md`](docs/voice/VOICE-AVATAR-PLATFORM.md) owns the voice/avatar technical rollout within this product contract.
5. [`docs/infra/README.md`](docs/infra/README.md) and linked records own infrastructure decisions.

If implementation changes one of these contracts, update the relevant document in the same pull request.

---

## Intent and scope of this pull request

This pull request establishes one unambiguous V1 product direction before implementation continues.
It consolidates the product contract into this file and removes the competing product-level source.

This pull request does:

- make `PRODUCT.md` the single V1 product contract;
- remove the duplicate V1 product-experience document;
- require a direct OpenAI Realtime voice-only conversation path;
- define LiveAvatar as the optional, user-selectable **Show tutor** presentation using the same
  `VoiceSessionSpec` and a clean voice-only fallback;
- keep curriculum, scoring, evidence, XP, entitlements, and unlocks under deterministic GlideLingo
  authority;
- separate session lifecycle, turn state, presentation state, and normalized provider events;
- preserve the existing `/v1` API convention.

This pull request does not:

- implement voice, avatar, Speak screens, realtime transports, provider adapters, or persistence;
- add or change runtime dependencies, routes, APIs, database schemas, workers, or infrastructure;
- select or change production model, voice, pricing, allowance, or retention configuration;
- enable lesson-tutor, RevenueCat, voice, avatar, or other dormant feature flags;
- create, rotate, expose, or consume provider credentials or secrets;
- deploy, release, migrate production data, or make any feature available to learners; or
- authorize future scaffolding beyond the smallest separately reviewed implementation slice.

The intended merge result is documentation clarity only. Runtime delivery begins in follow-up pull
requests that satisfy the gates defined here and in the linked technical contracts.

---

## 1. Product definition

### 1.1 One sentence

GlideLingo is a structured language course built around actually speaking the language.

### 1.2 Promise

**Learn it. Speak it. Use it. Get better.**

The learner always knows:

- what to do next;
- why it matters;
- what they can now do that they could not do before;
- what needs review;
- how to practice it in a real conversation.

### 1.3 Product pillars

| Pillar | Product consequence |
|---|---|
| Authored course | Curriculum order, objectives, examples, checks, and evidence rules are deterministic and reviewable. |
| Speaking throughout | Speaking is part of lessons and checkpoints, not a disconnected final feature. |
| Evidence-backed progress | Completion, XP, and mastery are separate. The app never calls tapping or time spent “mastery.” |
| Guided freedom | The course provides the next step; Practice and Speak let the learner explore safely. |
| Calm momentum | Progress is motivating without punishment, shame, lives, or manipulative urgency. |

### 1.4 V1 target learner

The primary V1 learner is an English-speaking adult beginning Standard Modern Greek at A0–A1 who wants practical reading, listening, and conversation ability. The architecture must support additional languages without hard-coded Greek-only navigation or progress logic.

### 1.5 V1 outcome

A successful learner can start from zero, complete a structured Greek Foundations path, practice weak material, and hold guided AI conversations using only language and support appropriate to their demonstrated level.

### 1.6 Non-goals

V1 is not:

- an open-ended chatbot with lessons attached;
- a photorealistic avatar product;
- a social network or public leaderboard;
- a marketplace of community courses;
- a claim of fluency based on XP, streaks, or lesson completion;
- a replacement for human teachers in high-stakes assessment;
- a collection of unrelated mini-games.

---

## 2. Requirement language and release definition

The words **MUST**, **SHOULD**, and **MAY** are normative.

- **MUST:** required for the defined release or behavior.
- **SHOULD:** expected unless a documented tradeoff is approved.
- **MAY:** optional enhancement.
- **CURRENT:** confirmed on `main` during the audit date above.
- **GAP:** required target behavior not yet present or incomplete on `main`.
- **LATER:** explicitly outside V1.

V1 is release-ready only when all requirements marked `V1` in this file pass acceptance testing. A screen shell, mock data, or hidden prototype does not count as completed behavior.

---

## 3. Current `main` reality

This table prevents target requirements from being mistaken for shipped behavior.

| Area | Current behavior | Target consequence |
|---|---|---|
| Stack | Expo SDK 57, React Native 0.86, Expo Router, TypeScript; Electron packaging on web; FastAPI services; Postgres; Cloud Run development infrastructure | Continue the existing modular monolith and vertical-slice approach. Do not split premature services. |
| Navigation | Home, Quests, Letters, Phrases, Profile | Replace primary navigation with Home, Course, Speak, Practice, Progress. Keep compatibility redirects. |
| Course | Greek Foundations, A0–A1, 12 modules and 26 lesson metadata records | Turn the existing catalog into the canonical Course experience. |
| Lesson content | The first letters lesson is fully authored; much of the remaining catalog is placeholder metadata | Placeholder lessons cannot count toward V1 course-complete acceptance. |
| Learning state | Local persisted lesson/review state and evidence stages exist | Preserve evidence semantics, then add server-backed sync. |
| Audio | Pre-generated Google TTS assets exist | Keep for authored content; do not confuse it with live conversation audio. |
| AI tutor | Contextual text tutor exists behind feature flags and Pro gating | Reuse its curriculum grounding and safety boundaries in the live coach. |
| Voice | No live microphone or realtime conversation path | Build the direct OpenAI Realtime voice-only baseline defined below. |
| Avatar | No learner-facing live avatar | Add optional Show tutor presentation without making voice depend on it. |
| Motivation | Weekly rhythm exists; XP, stars, and achievements do not | Add explicit mechanics without weakening the learning standard. |
| Progress | `/progress` redirects to Profile | Build a real Progress destination. |
| Identity/billing | Clerk and RevenueCat foundations exist | Use them for account and entitlement enforcement; no client-only paywalls. |

### 3.1 Current routes

| Current route | Current purpose | V1 route/behavior |
|---|---|---|
| `/` | Home and next-learning action | Keep as Home. |
| `/quests` | Module/course path | Redirect to `/course`. |
| `/path` | Redirects to Quests | Redirect to `/course`. |
| `/letters` | Greek letters exploration | Redirect to `/practice?mode=letters`. |
| `/phrases` | Phrase exploration | Redirect to `/practice?mode=phrases`. |
| `/review` | Redirects to Phrases | Redirect to `/practice?mode=review`. |
| `/profile` | Profile and progress summary | Keep for Profile/Settings only. |
| `/progress` | Redirects to Profile | Replace with real Progress screen. |
| `/course/[id]` | Course detail | Keep; align with Course tab. |
| `/lesson/[id]` | Lesson player | Keep; implement the complete lesson contract. |

---

## 4. Information architecture

### 4.1 Primary destinations

| Tab | User question it answers | Required purpose |
|---|---|---|
| **Home** | “What should I do now?” | Resume or start the single best next action, see today’s plan, and launch quick practice. |
| **Course** | “What am I learning and what comes next?” | Browse the authored path, units, lessons, prerequisites, and checkpoints. |
| **Speak** | “Can I use this in a conversation?” | Start guided scenarios or level-bounded free conversation with a voice coach. |
| **Practice** | “What should I strengthen?” | Review due or weak material by skill and mode. |
| **Progress** | “What can I now do?” | Show evidence, capability growth, activity, XP, achievements, and review needs separately. |

Profile and Settings are secondary destinations, not primary learning tabs.

### 4.2 Navigation requirements

| ID | Requirement | Release |
|---|---|---|
| NAV-001 | Mobile MUST use a five-item bottom bar in this order: Home, Course, Speak, Practice, Progress. | V1 |
| NAV-002 | Desktop/web MUST expose the same five destinations in a persistent sidebar. | V1 |
| NAV-003 | The active destination MUST be visually and accessibly identifiable. | V1 |
| NAV-004 | A language selector MUST be available in the desktop sidebar and mobile Profile/Settings. | V1 |
| NAV-005 | Profile, Settings, subscription, help, sign-out, theme, and account actions MUST live behind the profile control. | V1 |
| NAV-006 | Returning from a lesson or conversation MUST preserve the previously selected tab and scroll position when practical. | V1 |
| NAV-007 | Legacy routes in section 3.1 MUST redirect without losing a valid deep-link parameter. | V1 |
| NAV-008 | Navigation MUST remain usable with keyboard, screen reader, and 200% text scaling. | V1 |

---

## 5. Global product behavior

### 5.1 Shared header

Every primary screen MUST provide:

- the current language/course context;
- a profile/account entry point;
- consistent page title semantics;
- no duplicate primary action competing with the screen’s main task.

Desktop MAY show weekly rhythm and XP in the sidebar. Mobile SHOULD show them on Home and Progress rather than overcrowding the tab bar.

### 5.2 Global states

Every data-backed screen MUST define:

| State | Required behavior |
|---|---|
| Loading | Use a stable skeleton matching the final layout; avoid full-screen spinner flashes. |
| Empty | Explain why it is empty and provide the next valid action. |
| Offline | Preserve downloaded lesson/audio access where available; queue idempotent events; clearly disable live AI. |
| Recoverable error | Explain what failed in plain language and provide Retry. |
| Entitlement required | Explain the value, show the locked boundary, and provide a single upgrade action. |
| Permission denied | Explain why microphone/account permission is needed and how to enable it. |
| Unsupported course | Return to language/course selection without corrupting active progress. |

### 5.3 Product language

- Buttons MUST use actions: “Continue lesson,” “Start review,” “Practice speaking.”
- Mastery language MUST refer to evidence: “Demonstrated,” “Needs review,” “Retained.”
- The app MUST NOT say “mastered” because the learner earned XP, completed one activity, or obtained one correct recognition result.
- Corrections MUST be direct, neutral, and useful. No ridicule, loss-of-life mechanic, or shame copy.

---

## 6. Home

### 6.1 Purpose

Home is an action dashboard, not a catalog. A learner should identify the best next action within five seconds.

### 6.2 Priority algorithm

The primary Home action MUST be chosen in this order:

1. Resume an interrupted lesson or checkpoint with recoverable state.
2. Complete a critical due review when delaying it would weaken retained evidence.
3. Continue the next unlocked course lesson.
4. Complete an unlocked unit checkpoint.
5. Start a recommended speaking scenario tied to recently learned material.
6. Show course completion/next-course selection when no current step remains.

The algorithm MUST be deterministic for identical learner state. AI MAY produce supporting copy, but MUST NOT select or unlock curriculum steps.

### 6.3 Required layout

In order, Home MUST contain:

1. compact greeting and current course context;
2. one dominant Continue card;
3. Today plan;
4. quick actions for Speak and Practice;
5. compact progress metrics;
6. review cue when review is due;
7. most recent achievement or capability milestone, if one exists.

### 6.4 Requirements

| ID | Requirement | Release |
|---|---|---|
| HOME-001 | Continue card MUST show action type, title, short outcome, estimated duration, progress, and one CTA. | V1 |
| HOME-002 | Today plan MUST contain 1–3 achievable items generated from course and review state. | V1 |
| HOME-003 | Today plan MUST never require a paid/live action when the learner lacks entitlement or device support. | V1 |
| HOME-004 | Quick Speak MUST recommend a scenario using capabilities the learner has encountered. | V1 |
| HOME-005 | Quick Practice MUST open the highest-priority due or weak set. | V1 |
| HOME-006 | Metrics MUST show weekly rhythm, total XP, and current course completion; evidence remains visible on Progress. | V1 |
| HOME-007 | Completing an action MUST update Home without requiring app restart. | V1 |
| HOME-008 | Multiple cards MUST NOT compete visually with the primary Continue action. | V1 |

---

## 7. Course

### 7.1 Purpose

Course makes the authored learning path legible. It shows what the learner has completed, what is available now, what is locked, and what each unit enables.

### 7.2 Course overview

The Course root MUST show:

- current language, course title, level, and dialect;
- overall course progress;
- current unit and next lesson;
- all units in curriculum order;
- unit outcome, lesson count, checkpoint status, and evidence summary;
- clear states: locked, available, in progress, completed, demonstrated, retained.

### 7.3 Unit detail

Each unit MUST show:

- a practical “You will be able to…” outcome;
- ordered lesson list;
- activity/skill tags where useful;
- expected time;
- prerequisite explanation when locked;
- unit checkpoint;
- stars/evidence earned for that unit;
- recommended conversation unlocked by the unit.

### 7.4 Course requirements

| ID | Requirement | Release |
|---|---|---|
| COURSE-001 | Curriculum order and prerequisites MUST come from authored catalog data, never model generation. | V1 |
| COURSE-002 | Only the next valid lesson/checkpoint MAY become unlocked. | V1 |
| COURSE-003 | A learner MAY replay a completed lesson without changing historical first-completion evidence. | V1 |
| COURSE-004 | A placeholder lesson MUST be visibly unavailable in non-production builds and MUST NOT ship as complete content. | V1 |
| COURSE-005 | Course completion MUST require all required units and checkpoints, not 100% XP or optional practice. | V1 |
| COURSE-006 | Switching courses MUST preserve separate progress, review queues, XP events, and conversation evidence. | V1 |
| COURSE-007 | Course cards MUST not advertise Spanish/French as available until their authored content passes the same validation. | V1 |

---

## 8. Lesson engine and course flow

### 8.1 Learning sequence

Each instructional capability SHOULD move through:

1. **Encounter** — hear or see meaningful language.
2. **Notice and understand** — focus on meaning, sound, pattern, or form.
3. **Retrieve** — recall without simply copying the answer.
4. **Produce** — say or construct the language.
5. **Perform** — use it in a fresh prompt or scenario.
6. **Revisit** — review later for retention.

Not every lesson needs six visible sections, but the unit must provide the complete evidence path.

### 8.2 Lesson lifecycle

`not_started -> in_progress -> completed`

Completion is separate from evidence. Each attempt MUST record the capability, mode, prompt variant, response, result, support level, and timestamp needed by the learning standard.

If the learner exits, the player MUST save the last safe activity boundary. It MUST NOT resume in the middle of a recording upload or scoring transaction.

### 8.3 Required lesson structure

| Stage | Required UI/behavior |
|---|---|
| Start | Outcome, estimated time, skill focus, audio/mic expectations, Start CTA. |
| Activity | One clear task, progress indicator, replay where allowed, accessible prompt, answer controls. |
| Feedback | Correct/incorrect/needs another listen, short reason, replay or retry, no reward inflation. |
| Recovery | Hint, slower audio, transliteration policy, or explanation based on authored rules. |
| Completion | Outcome recap, evidence earned, XP earned, new unlock, next action. |

### 8.4 Supported V1 activity types

- listen and choose;
- match meaning;
- order/build phrase;
- type short response;
- letter/sound recognition;
- listen and repeat;
- controlled speaking prompt;
- mini role-play turn;
- review/checkpoint item.

### 8.5 Lesson requirements

| ID | Requirement | Release |
|---|---|---|
| LESSON-001 | Every lesson MUST have a stable ID, objective, capability IDs, authored activities, answer rules, audio references, and completion rule. | V1 |
| LESSON-002 | A lesson MUST continue without AI when all required assets are available. | V1 |
| LESSON-003 | AI explanation MAY clarify authored material but MUST NOT silently change the expected answer or progression. | V1 |
| LESSON-004 | Audio controls MUST include replay and respect device mute/accessibility behavior. | V1 |
| LESSON-005 | Speech recognition confidence MUST NOT be presented as pronunciation accuracy. | V1 |
| LESSON-006 | A speaking task MUST offer a non-punitive retry and a fallback when microphone use is impossible. | V1 |
| LESSON-007 | Completion writes and XP grants MUST be idempotent. | V1 |
| LESSON-008 | The completion screen MUST show the actual reason for every star/evidence change. | V1 |

### 8.6 Checkpoints

A unit checkpoint is a short fresh performance, not a replay of the lesson quiz.

- It MUST sample the unit’s required capabilities.
- It MUST vary prompts or context enough to test retrieval.
- It MUST record support used.
- It MUST allow a retry path without erasing the first attempt.
- Failing or abandoning it MUST recommend exact lessons/practice sets.
- Passing it MAY unlock the next unit and the second evidence star.

---

## 9. Speak

### 9.1 Purpose

Speak turns learned material into live use. It has two modes:

| Mode | Purpose | V1 access |
|---|---|---|
| Guided conversation | Goal-based authored scenario with controlled vocabulary, turn goals, hints, and completion evidence | Required |
| Just Talk | Open conversation bounded by level, language, safety, and known capabilities | Required after at least one guided scenario or explicit orientation |

### 9.2 Speak home

Speak MUST show:

- recommended scenario tied to the current course position;
- scenario library by topic and difficulty;
- recent conversations and recap access;
- Just Talk entry;
- microphone/device readiness;
- user-selectable Show tutor when optional avatar presentation is available;
- clear entitlement status before session launch.

### 9.3 Guided scenario contract

Every scenario MUST define:

- stable scenario ID and version;
- setting and learner goal;
- required and optional capability IDs;
- permitted language level and coach persona;
- authored opening and success conditions;
- target turn range and maximum duration;
- hint ladder;
- correction policy;
- safety/fallback responses;
- evidence mapping and completion rule.

Examples include greeting someone, ordering coffee, asking where something is, introducing yourself, and making a simple purchase.

### 9.4 Live session, turn, and presentation states

The UI and durable model MUST keep three state domains separate:

| Domain | States | UI meaning |
|---|---|---|
| Session lifecycle | `creating`, `connecting`, `active`, `reconnecting`, `ending`, `ended`, `failed` | Whether the application session is being admitted, connected, used, recovered, or closed. |
| Turn state while active | `ready`, `listening`, `thinking`, `speaking`, `interrupted` | What the learner and coach are doing inside an active session. |
| Presentation | `voice-only`, `avatar-connecting`, `avatar-active`, `avatar-failed` | Whether optional Show tutor media is being presented. |

Transcript, response, audio, interruption, scenario-observation, warning, and failure messages are typed events. `needs-clarification`, `goal-observed`, and `needs-repeat` are outcomes/events, not session lifecycle states. Avatar presentation failure MUST NOT mark the session failed while voice remains healthy.

### 9.5 Conversation behavior

| ID | Requirement | Release |
|---|---|---|
| SPEAK-001 | V1 MUST launch with push-to-talk/turn-based voice before full duplex interruption. | V1 |
| SPEAK-002 | The interface MUST show when it is listening, thinking, and speaking. | V1 |
| SPEAK-003 | Partial transcripts MAY aid turn-taking but MUST NOT be stored as final evidence. | V1 |
| SPEAK-004 | The coach MUST stay within the selected course language, learner level, scenario, and known support policy. | V1 |
| SPEAK-005 | The coach SHOULD correct high-value errors after the turn, not interrupt every mistake. | V1 |
| SPEAK-006 | Learners MUST be able to request repeat, slower speech, translation, a hint, or a suggested reply. | V1 |
| SPEAK-007 | Hints/support MUST be recorded because supported performance is not independent performance. | V1 |
| SPEAK-008 | Scenario completion MUST depend on authored goals/evidence, not conversation duration alone. | V1 |
| SPEAK-009 | A session MUST recover from transient disconnect without duplicate conversation or XP events. | V1 |
| SPEAK-010 | If live AI fails, the user MUST receive a clean exit and no false completion. | V1 |
| SPEAK-011 | Just Talk MUST not unlock curriculum or mastery evidence unless an authored evaluation rule explicitly maps the turn. | V1 |
| SPEAK-012 | The learner MUST be able to view, delete, or exclude conversation history under the retention policy. | V1 |

### 9.6 Conversation recap

The recap MUST separate:

- scenario goal completion;
- what the learner communicated successfully;
- 1–3 useful corrections;
- target phrases with audio;
- transcript, if consented and retained;
- support used;
- evidence gained or still needed;
- XP earned;
- Retry, Practice these items, and Continue course actions.

The recap MUST NOT show a fabricated pronunciation percentage. Pronunciation feedback is allowed only for dimensions the scoring system can validly support.

---

## 10. Practice

### 10.1 Purpose

Practice is the learner-controlled strengthening space. It does not replace the course path.

### 10.2 Modes

| Mode | Input source | Completion rule |
|---|---|---|
| Recommended | Due, weak, and recently learned capabilities | Finish the generated finite set. |
| Review | Scheduled review queue | Complete all items in the selected review session. |
| Mistakes | Recent incorrect or high-support attempts | Correct or intentionally defer each selected item. |
| Vocabulary & Phrases | Authored phrase inventory | Complete selected set; browsing alone earns no XP. |
| Listening | Authored audio and comprehension checks | Complete selected set. |
| Pronunciation | Eligible sound/phrase prompts | Record and receive valid feedback or self-comparison fallback. |
| Speaking Drills | Controlled production prompts | Complete required spoken turns. |
| Letters & Sounds | Script/sound inventory | Complete selected recognition or production set. |

### 10.3 Practice requirements

| ID | Requirement | Release |
|---|---|---|
| PRACTICE-001 | Recommended practice MUST be deterministic from evidence and review state. | V1 |
| PRACTICE-002 | Every practice session MUST have a finite visible size before it starts. | V1 |
| PRACTICE-003 | The learner MAY choose a mode, skill, unit, and session size when data exists. | V1 |
| PRACTICE-004 | Browsing, replaying audio, or abandoning a set MUST NOT earn completion XP. | V1 |
| PRACTICE-005 | Correct answers with heavy hints MUST update evidence differently from independent answers. | V1 |
| PRACTICE-006 | Practice results MUST immediately update due/weak recommendations and Progress. | V1 |
| PRACTICE-007 | No-due-review state MUST celebrate that fact and offer optional strengthening, not invent urgency. | V1 |

---

## 11. Progress

### 11.1 Purpose

Progress answers “What can I do now?” It MUST keep learning evidence, activity, and game mechanics visibly distinct.

### 11.2 Required sections

| Section | Required contents |
|---|---|
| Overview | Current course, completion, weekly rhythm, total XP, next milestone. |
| Capabilities | Introduced, practiced, demonstrated, retained, and needs-review capabilities. |
| Skills | Reading, listening, speaking, vocabulary/phrases, and script progress where supported. |
| Course | Unit/lesson/checkpoint completion and stars. |
| Activity | Days learned, lessons, practice sets, speaking sessions, recent history. |
| Achievements | Earned and clearly explained locked achievements. |
| Review | Due now, upcoming, and weak areas with direct Practice CTA. |

### 11.3 Requirements

| ID | Requirement | Release |
|---|---|---|
| PROGRESS-001 | Progress MUST derive learning claims from evidence records, not XP totals. | V1 |
| PROGRESS-002 | Every star or evidence label MUST expose an explanation of how it was earned. | V1 |
| PROGRESS-003 | Time ranges MUST include at least This week, This month, and All time for activity metrics. | V1 |
| PROGRESS-004 | Empty charts MUST use meaningful empty states rather than zero-filled fake history. | V1 |
| PROGRESS-005 | A due/weak capability MUST link to a valid practice action. | V1 |
| PROGRESS-006 | Data shown after sync MUST be consistent across devices for signed-in users. | V1 |

---

## 12. Profile, settings, language, and account

Profile is identity and configuration, not the primary progress screen.

### 12.1 Required groups

- account identity and sign-in state;
- current language/course and course switching;
- daily/weekly learning preferences;
- audio speed, autoplay, microphone, captions/transcript, and transliteration preferences;
- theme and accessibility preferences;
- notification preferences;
- subscription and entitlement state;
- conversation data/privacy controls;
- download/offline storage controls when supported;
- help, legal, version, sign out, and account deletion.

### 12.2 Requirements

| ID | Requirement | Release |
|---|---|---|
| PROFILE-001 | Switching language/course MUST require confirmation if an active lesson or live session would be abandoned. | V1 |
| PROFILE-002 | Changing course MUST not erase any course’s progress. | V1 |
| PROFILE-003 | Account deletion and conversation-history deletion MUST be distinct, clearly explained actions. | V1 |
| PROFILE-004 | Preferences MUST sync for signed-in users and degrade safely for guests. | V1 |
| PROFILE-005 | Subscription status MUST come from verified server entitlement data. | V1 |

---

## 13. Onboarding and first-use flow

### 13.1 Goal

Onboarding gets a learner to a meaningful first learning action quickly while collecting only information that changes the experience.

### 13.2 Flow

1. Choose learning language/course.
2. Confirm source language.
3. Choose experience level: New, Know a little, or Placement check.
4. Choose practical goal(s): travel, conversation, family, work, culture, other.
5. Choose a realistic weekly rhythm target.
6. Explain microphone value and request permission only immediately before the first speaking action.
7. Start the recommended first lesson or placement check.
8. Create/sign in to an account at a durable-value boundary; preserve guest progress through conversion.

### 13.3 Requirements

| ID | Requirement | Release |
|---|---|---|
| ONBOARD-001 | Onboarding MUST be skippable except for language/course selection. | V1 |
| ONBOARD-002 | Placement MUST use authored checks and evidence rules. | V1 |
| ONBOARD-003 | A placement result MUST explain what was skipped and allow the learner to start earlier. | V1 |
| ONBOARD-004 | Microphone permission MUST be contextual and denial MUST not block non-speaking lessons. | V1 |
| ONBOARD-005 | The first meaningful learning action SHOULD begin within two minutes for a new learner. | V1 |

---

## 14. XP, stars, rhythm, achievements, and celebrations

These mechanics motivate activity. They do not certify learning. Adding XP/stars requires updating `docs/learning/LEARNING-STANDARD.md` in the same implementation change because that document currently treats generalized XP/badges as deferred mechanics.

### 14.1 XP event rules

| Event | XP | Grant rule |
|---|---:|---|
| First completion of an authored lesson | 80 | Once per learner + lesson version. |
| Meaningful lesson replay | 20 | Requires completion; max once per lesson per learner-local day. |
| Qualifying practice set | 25 | At least 5 scored attempts and set completion. |
| Due-review session | 30 | Complete the finite due set selected at session start. |
| First completion of a guided conversation | 150 | Meets authored scenario completion rule. |
| Guided conversation replay | 50 | Meets completion again; max once per scenario per learner-local day. |
| First demonstrated unit checkpoint | 100 | Once per checkpoint version. |
| First retained capability star | 150 | Once per capability evidence milestone. |

No XP is granted for opening a page, idle time, replaying audio, tapping through content, viewing a transcript, abandoning a session, or an achievement unlock by itself.

### 14.2 XP requirements

| ID | Requirement | Release |
|---|---|---|
| XP-001 | XP MUST be an append-only event ledger with stable event IDs and idempotent grants. | V1 |
| XP-002 | The client MAY show optimistic XP only when it can reconcile with the authoritative ledger. | V1 |
| XP-003 | Every grant MUST store learner, course, source type, source ID/version, amount, learner-local date, and timestamp. | V1 |
| XP-004 | XP MUST NOT unlock lessons, produce mastery labels, or replace evidence. | V1 |
| XP-005 | XP rules MUST be remotely versioned/configurable without changing historical events. | V1 |
| XP-006 | The completion UI MUST itemize the grant; it MUST not animate XP before success is durable. | V1 |

### 14.3 Three-star evidence model

| Star | Meaning | Minimum evidence |
|---|---|---|
| ★ Learned | The capability was completed in its required lesson set. | Required lesson activity completion. |
| ★★ Demonstrated | The learner performed it in a fresh or varied checkpoint with acceptable support. | Authored checkpoint rule. |
| ★★★ Retained | The learner performed it again after the defined delay or in a valid transfer context. | Retention/transfer rule in the learning standard. |

Stars MUST be derived, never bought, manually awarded, or calculated from XP.

### 14.4 Weekly rhythm

Weekly rhythm is the primary consistency mechanic: for example, **2 of 3 learning days this week**.

- A qualifying day requires one completed lesson, qualifying practice/review set, or completed guided conversation.
- The learner chooses a 2–7 day weekly target.
- Missing a day does not erase prior progress.
- The week boundary uses the learner’s configured timezone.
- Consecutive-day streaks are `LATER` unless a separate product/learning policy approves them.

### 14.5 Achievements

V1 achievements MUST correspond to meaningful firsts or sustained behavior:

- First Lesson;
- First Spoken Turn;
- First Guided Conversation;
- First Unit Demonstrated;
- First Retained Capability;
- Weekly Rhythm Met;
- Course Halfway;
- Course Completed.

Each achievement MUST define a stable ID, title, explanation, icon, rule version, earned time, and deep link. Hidden or luck-based achievements are out of V1.

### 14.6 Celebration hierarchy

| Level | Use | UI |
|---|---|---|
| Micro | Correct response, finished practice item | Brief inline response; no blocking modal. |
| Standard | Lesson/practice/conversation completed | Completion panel with evidence, XP, and next action. |
| Milestone | Unit checkpoint, retained star, achievement | Short celebratory motion/sound respecting reduced motion and mute. |
| Major | Course completion | Dedicated recap and shareable card; never auto-share. |

Celebrations MUST NOT slow the learner’s next action, repeat on every page load, or imply stronger evidence than was earned.

---

## 15. AI tutor and coach

### 15.1 Roles

| Role | Where | Responsibility |
|---|---|---|
| Tutor | Lesson/course context | Explain authored material, give bounded hints, answer relevant questions. |
| Coach | Speak | Run the scenario, keep the conversation level-appropriate, and provide useful recap. |
| Recommender | Home/Practice | Explain deterministic next actions; it does not independently reorder curriculum. |

### 15.2 Grounding contract

Every tutor/coach request MUST include only the needed context:

- learner target/source language and level;
- active course/unit/lesson/scenario IDs and versions;
- relevant authored capabilities, examples, and answer policy;
- known support/transliteration preferences;
- current conversation turns within the retention window;
- explicit output/safety constraints.

### 15.3 AI requirements

| ID | Requirement | Release |
|---|---|---|
| AI-001 | Deterministic curriculum, unlocks, scoring, XP, and evidence MUST remain application logic. | V1 |
| AI-002 | Model output MUST be treated as untrusted and schema-validated before use. | V1 |
| AI-003 | The tutor MUST say when it lacks enough context instead of inventing course facts. | V1 |
| AI-004 | Prompt/model versions and latency/error metadata MUST be observable without storing unnecessary learner audio. | V1 |
| AI-005 | Safety behavior MUST cover harassment, sexual content, self-harm, illegal requests, and attempts to escape the learning role. | V1 |
| AI-006 | Model/provider failure MUST not prevent authored lesson completion. | V1 |
| AI-007 | AI evaluation MAY assist feedback, but required evidence claims MUST use validated rubrics and confidence/fallback rules. | V1 |

---

## 16. Voice and avatar platform

### 16.1 Locked product decision

GlideLingo has three separate audio concerns. They MUST remain separate because they solve different product problems:

| Experience | Required pipeline | Why |
|---|---|---|
| Authored lesson audio | Authored text -> Google Text-to-Speech -> stored/cached audio asset | Deterministic, reusable, fast, inexpensive, and already implemented. |
| Live AI conversation | Learner microphone <-> OpenAI Realtime audio | One consistent multilingual conversation engine that always works voice-only. |
| Optional tutor presentation | OpenAI Realtime session -> LiveAvatar LITE -> synchronized tutor media | User-selectable Show tutor presentation over the same conversation contract. |
| Pronunciation assessment | Learner recording -> separately validated audio evaluator | A transcript or successful conversation does not prove pronunciation quality. |

Google-generated lesson audio remains the source for static course examples. It MUST NOT be replaced merely to make the live stack uniform.

OpenAI Realtime is the required live conversation engine. It listens to the learner, manages the spoken turn, creates the response, and returns spoken audio. V1 MUST always provide a direct voice-only conversation path. GlideLingo supplies bounded course/scenario context and remains authoritative for curriculum, scoring, completion, evidence, XP, entitlements, unlocks, and safety policy.

HeyGen LiveAvatar LITE is the selected optional V1 avatar adapter. When the learner selects **Show tutor**, it may render a lip-synchronized tutor from the same `VoiceSessionSpec`. It is a presentation dependency only: voice MUST continue without it, and neither LiveAvatar nor OpenAI may own learning or entitlement state.

The complete implementation contract, managed-connector path, custom-agent fallback, session lifecycle, security rules, rollout gates, and official sources are in [`docs/voice/VOICE-AVATAR-PLATFORM.md`](docs/voice/VOICE-AVATAR-PLATFORM.md).

### 16.2 End-to-end live experience

1. The learner chooses a guided scenario or Just Talk and may select Show tutor before starting.
2. GlideLingo verifies access, resolves one authoritative `VoiceSessionSpec`, and supplies only the
   bounded context required for the selected scenario.
3. The direct voice-only conversation begins. If Show tutor is selected and available, the optional
   avatar presentation uses the same session and learning contract.
4. The UI shows session lifecycle separately from turn and presentation state.
5. If avatar presentation is unavailable or fails, GlideLingo continues voice-only at a safe turn
   boundary without duplicating effects.
6. On end, GlideLingo applies deterministic scenario and evidence rules once, then returns the recap
   and next action.

OpenAI and LiveAvatar MUST NOT call progress APIs directly, award XP, unlock lessons, decide mastery, authorize entitlement, or silently alter the scenario.

### 16.3 Provider and application ownership

| Layer | Locked V1 responsibility |
|---|---|
| Existing Google TTS assets | Generate and serve deterministic lesson examples and authored prompts. |
| Expo / Electron client | Mic permission, realtime connection, optional avatar media, captions, learner controls, reconnect and fallback UI. |
| Public FastAPI API | Authentication, entitlement, usage limits, session creation/end, context assembly, persistence, and authoritative outcomes. |
| HeyGen LiveAvatar LITE | Optionally render the selected tutor and synchronize it to the OpenAI response when Show tutor is enabled. |
| OpenAI Realtime | Required multilingual live listening, turn handling, conversation response, spoken output, and supported bounded tool calling. |
| GlideLingo learning policy | Scenario goal, allowed content, learner level, hints, success rubric, correction rules, evidence, XP, and unlocks. |
| Audio evaluator | Optional pronunciation/acoustic feedback only after per-language validation. |

### 16.4 Platform contract

The required direct voice path, optional presentation adapter, API shapes, transport, normalized
events, security rules, and provider rollout gates belong to the subordinate
[`docs/voice/VOICE-AVATAR-PLATFORM.md`](docs/voice/VOICE-AVATAR-PLATFORM.md) technical contract.
Every voice API remains under the repository's existing `/v1` convention.

### 16.5 Voice requirements

| ID | Requirement | Release |
|---|---|---|
| VOICE-001 | OpenAI Realtime MUST power a direct voice-only conversation path for every released language; per-language release requires measured understanding, accent, dialect, latency, and safety gates. | V1 |
| VOICE-002 | Google pre-generated audio MUST remain the authored lesson-audio path. | V1 |
| VOICE-003 | Provider APIs and long-lived secrets MUST remain server-side; the client receives only short-lived, minimally scoped connection material. | V1 |
| VOICE-004 | V1 MUST support explicit Start, mute/unmute, interrupt/stop response, End session, captions, and retry/reconnect controls. | V1 |
| VOICE-005 | Session lifecycle (`creating`, `connecting`, `active`, `reconnecting`, `ending`, `ended`, `failed`) MUST be modeled separately from turn state (`ready`, `listening`, `thinking`, `speaking`, `interrupted`), presentation state, normalized provider events, and authoritative evidence writes. | V1 |
| VOICE-006 | Raw production audio retention MUST default off. Any diagnostic retention requires explicit consent, encryption, purpose, access control, and deletion window. | V1 |
| VOICE-007 | No released language may be assumed correct because the provider markets multilingual support; it MUST pass GlideLingo's language-specific evaluation set. | V1 |
| VOICE-008 | A correct transcript MUST NOT be presented as pronunciation accuracy. | V1 |
| VOICE-009 | A live-session failure MUST NOT affect authored lesson playback or completion. | V1 |
| VOICE-010 | Full-duplex/barge-in MAY ship only after learner-pause and interruption tests pass; controlled turns remain the fallback. | V1 |

### 16.6 Avatar requirements

| ID | Requirement | Release |
|---|---|---|
| AVATAR-001 | HeyGen LiveAvatar LITE is the selected optional V1 adapter behind the user-selectable Show tutor control. | V1 |
| AVATAR-002 | Show tutor MUST use the same `VoiceSessionSpec`, persona, voice, scenario, and learning policy as voice-only; it MUST NOT own course, scoring, evidence, XP, entitlement, or unlock state. | V1 |
| AVATAR-003 | Show tutor availability and presentation state MUST be modeled separately from session lifecycle and turn state. | V1 |
| AVATAR-004 | Avatar unavailability or failure MUST stop avatar usage and continue OpenAI voice + captions + static portrait without ending an otherwise healthy conversation. | V1 |
| AVATAR-005 | Audio playback MUST take priority over video/lip-sync quality; avatar buffering MUST NOT delay the coach response. | V1 |
| AVATAR-006 | The client MUST expose a pre-session Show tutor control plus reduced-motion, captions, volume, mute, and accessible state labels. | V1 |
| AVATAR-007 | Avatar, voice, language, and persona IDs MUST be versioned server-side configuration, not hard-coded across screens. | V1 |
| AVATAR-008 | Every session MUST have an explicit maximum duration and guaranteed provider cleanup. | V1 |

### 16.7 Learning authority and realtime tools

OpenAI may propose a scenario observation or call an allowlisted GlideLingo tool. Deterministic backend code MUST validate the request and remains the only authority that can:

- load bounded learner/course/scenario context;
- issue a hint or repeat request;
- record support used;
- mark an authored scenario goal observed;
- propose a correction for recap;
- end a scenario at an allowed transition;
- create evidence or grant XP after completion rules pass.

OpenAI and LiveAvatar MUST receive only the minimum context required for the current session. Neither provider receives raw Clerk/RevenueCat identity, unrelated history, unrestricted database access, or authority over curriculum, scoring, XP, evidence, entitlements, or unlocks.

### 16.8 Scale, reliability, and cost controls

- Static Google lesson audio remains cacheable and consumes no live-session minutes.
- Live sessions MUST enforce plan allowance, one active session per learner by default, idle timeout, maximum duration, and server-side rate limits.
- The provider session MUST stop after completion, cancel, disconnect timeout, allowance expiry, or unrecoverable error.
- Cost telemetry MUST attribute direct OpenAI Realtime usage, optional LiveAvatar connected minutes/credits, transport, and any fallback provider cost separately to the application session.
- Start, stop, reconnect, transcript processing, recap, evidence, and XP writes MUST be idempotent.
- Provider failures MUST emit typed error codes and user-safe recovery actions.
- A plan MUST remain margin-positive at its included minute allowance before broad rollout.

---

## 17. Access and subscription

Exact price and allowance numbers are commercial configuration, not hard-coded product logic. V1 uses these entitlement principles:

| Capability | Guest/Free | Pro |
|---|---|---|
| Browse available course and start first meaningful lesson | Yes | Yes |
| Continue full authored course | Configurable free-unit boundary | Yes |
| Core offline authored audio | Available for unlocked lessons | Yes |
| Deterministic review/practice | Limited to unlocked material | Yes |
| Contextual AI tutor | Trial/configurable limit | Yes, usage policy applies |
| Guided AI conversations | One explicit trial when commercially enabled | Yes, minute allowance applies |
| Just Talk | No | Yes, minute allowance applies |
| Full history and cross-device sync | Account required | Yes |

Requirements:

- The learner MUST reach one meaningful learning moment before the first upgrade prompt.
- Locked content MUST explain what is included; it MUST NOT fake an error.
- Entitlements MUST be verified server-side and work across supported platforms.
- Restore purchase, grace period, cancellation, and expired states MUST have defined UI.
- Exhausting live minutes MUST end at a turn boundary with warning, recap access, and no data loss.

---

## 18. Data and state contracts

### 18.1 Sources of truth

| Data | Source of truth |
|---|---|
| Course structure/content/version | Authored repository catalog/content files. |
| Learning/evidence policy | Learning standard and deterministic application rules. |
| Signed-in progress/evidence | Server database; local state is cached/queued. |
| Guest progress | Local durable state until account conversion. |
| XP | Server append-only ledger. |
| Entitlement | Server-verified billing provider state. |
| Live session | Server orchestration + room state; client renders and sends media/events. |
| UI preference | Synced account setting with local fallback. |

### 18.2 Required entities

The implementation MUST support stable, versioned forms of:

- `LearnerProfile`
- `Course`, `Unit`, `Lesson`, `Activity`, `Capability`
- `LessonAttempt`, `ActivityAttempt`, `CapabilityEvidence`
- `ReviewItem`, `PracticeSession`
- `Scenario`, `ConversationSession`, `ConversationTurn`, `ConversationEvidence`
- `XpEvent`, `Achievement`, `LearnerAchievement`, `WeeklyRhythm`
- `Entitlement`, `UsageAllowance`

### 18.3 Minimum event fields

Every learning or product event MUST include:

- event ID and schema version;
- learner/anonymous session ID as allowed;
- course/content/scenario version identifiers;
- source screen/action;
- server and learner-local timestamp where relevant;
- outcome and support level where relevant;
- platform/app version;
- correlation/session ID for retries and deduplication.

### 18.4 Sync requirements

- All mutation endpoints MUST accept idempotency keys.
- Offline queues MUST preserve order within a lesson/session and tolerate duplicate delivery.
- Conflict resolution MUST not erase stronger historical evidence.
- Content version migrations MUST be explicit; changed answer rules cannot rewrite old attempts.
- Guest-to-account conversion MUST merge rather than silently replace either state.

---

## 19. Notifications and return loops

V1 MAY send reminders only after opt-in.

- Weekly rhythm reminder: on a learner-selected day/time when target is at risk.
- Review reminder: when meaningful review is due, with a direct Practice deep link.
- Continue reminder: for a genuinely interrupted lesson, not generic guilt copy.
- Milestone recap: optional, low frequency.

Notification copy MUST state the real action available. Frequency caps, timezone, quiet hours, and per-type controls are required before any notification type is enabled.

---

## 20. Accessibility, privacy, and safety

### 20.1 Accessibility

- All core flows MUST work by keyboard and screen reader.
- Text and controls MUST meet WCAG AA contrast targets.
- Touch targets MUST meet platform minimums.
- Captions/transcripts MUST be available for coach audio where technically possible.
- Meaning MUST not depend only on color, sound, or animation.
- Reduced-motion settings MUST disable nonessential celebration/avatar motion.
- Language text MUST expose correct locale/pronunciation metadata to assistive technology.

### 20.2 Privacy

- Microphone activity MUST always be visible.
- Raw microphone audio defaults to transient processing, not storage.
- Transcript/history retention MUST be disclosed and controllable.
- Analytics MUST avoid unnecessary raw learner speech or free-text content.
- Account and conversation deletion requests MUST propagate to relevant stores/providers.

### 20.3 Safety

- The AI coach MUST remain in an educational role and provide safe redirection where needed.
- Minors, if later supported, require a separate policy and consent design; V1 targets adults.
- Report/problem controls MUST be available from AI recaps and tutor responses.
- Abuse controls MUST protect live infrastructure without blocking normal language mistakes or accents.

---

## 21. Analytics and quality gates

### 21.1 Product funnel

Track at minimum:

1. onboarding started/completed;
2. first lesson started/completed;
3. first spoken turn attempted/completed;
4. first unit/checkpoint completed;
5. first guided conversation started/completed;
6. week-one return and weekly rhythm completion;
7. trial/paywall viewed and entitlement activated;
8. live allowance used and session failure/abandonment.

### 21.2 Learning quality

Track:

- independent versus supported success;
- checkpoint pass/retry by capability;
- review due/completed/overdue;
- evidence progression and regression/needs-review;
- speech no-match/clarification rate;
- hint and translation usage;
- conversation goal completion and correction follow-through.

### 21.3 Voice quality

Track distributions, not just averages:

- room connect success/time;
- end-of-turn to final transcript;
- final transcript to first audio;
- full perceived turn gap;
- reconnect rate;
- STT no-match and manual correction rate by locale/device class;
- TTS cancellation and user interruption;
- session cost by provider/layer;
- session completion and immediate satisfaction.

### 21.4 Launch gates

Before broad V1 launch:

- all required Greek lessons and checkpoints validate with no placeholder content;
- crash-free and lesson-save reliability meet the team’s release SLO;
- no duplicate XP/evidence in retry and offline tests;
- live connection and turn latency meet section 16 targets on supported networks;
- conversation rubric evals pass level, relevance, correction, and safety thresholds;
- cost-per-completed conversation supports the selected plan allowance;
- accessibility and privacy reviews pass.

---

## 22. Route and component migration

| Existing concept | V1 destination | Migration requirement |
|---|---|---|
| Home | Home | Refactor into priority Continue + Today + quick actions. |
| Quests | Course | Preserve catalog/unit progress while changing label and hierarchy. |
| Letters | Practice / Letters & Sounds | Keep authored assets and deep-link compatibility. |
| Phrases | Practice / Vocabulary & Phrases | Keep authored assets and deep-link compatibility. |
| Review redirect | Practice / Review | Replace redirect-only page with queue-backed session. |
| Profile progress summary | Progress | Move learning evidence/activity; leave account/settings in Profile. |
| Contextual text tutor | Lesson tutor + Speak coach foundation | Keep flags, grounding, and entitlement; separate lesson and live-session contracts. |
| Pre-generated Google audio | Lesson audio | Keep and cache. Live conversation uses a separate direct OpenAI Realtime path with optional LiveAvatar presentation. |

Final route contract:

```text
/
/course
/course/[id]
/unit/[id]
/lesson/[id]
/speak
/speak/scenario/[id]
/speak/session/[id]
/speak/recap/[id]
/practice
/practice/session/[id]
/progress
/profile
/settings
```

---

## 23. Delivery order

Build vertical slices that are independently testable and useful.

### Slice 1 — Canonical course shell

- replace primary navigation;
- migrate Quests to Course and Letters/Phrases/Review to Practice;
- build real Progress shell from existing data;
- preserve legacy redirects.

### Slice 2 — Complete learning loop

- finish authored lesson/player contract;
- implement checkpoints, evidence explanations, deterministic recommendations;
- add server-backed progress sync and offline idempotency.

### Slice 3 — Motivation system

- update the learning standard with XP/star guardrails;
- implement XP ledger, weekly rhythm, achievements, and celebrations;
- validate duplicate/offline/timezone behavior.

### Slice 4 — Direct OpenAI Realtime voice vertical slice

- implement the authenticated FastAPI session create/end/recap boundary;
- freeze `VoiceSessionSpec` and separate session lifecycle, turn state, presentation state, and normalized events;
- connect one Greek guided scenario directly to OpenAI Realtime voice-only;
- inject bounded course/scenario context and preserve deterministic completion rules;
- implement captions, controls, cleanup, entitlement, latency, and cost telemetry on physical mobile targets and Electron.

### Slice 5 — Optional Show tutor and learning-control gate

- add the user-selectable Show tutor presentation using the same `VoiceSessionSpec`;
- prove managed-connector tool calls, cancellation, dynamic context, observability, and clean voice-only fallback;
- keep the LiveAvatar managed connector only if it satisfies the contract;
- otherwise add the private `services/voice-agent` custom LiveKit participant without changing the client/product contract;
- add recap, evidence, XP idempotency, transcript retention controls, and per-language evals.

### Slice 6 — Scale and polish

- load/concurrency testing and maximum-duration enforcement;
- operational dashboards, typed provider errors, and separately metered voice/avatar fallback paths;
- accessibility, localization, notification, subscription-state, and avatar/persona configuration polish.

Do not let optional avatar work delay the complete Greek course, learning loop, or reliable direct voice path. Do not begin public leaderboards, social features, or additional languages before those foundations meet their gates.

---

## 24. V1 end-to-end acceptance scenarios

### 24.1 New learner

1. Learner selects Greek and begins from zero.
2. Home recommends the first valid lesson.
3. Learner completes authored reading/listening/speaking activities.
4. Completion records evidence and exactly one 80 XP event.
5. Home, Course, and Progress update consistently.
6. The next valid lesson unlocks; no unrelated lesson unlocks.

### 24.2 Returning learner with review due

1. Home shows a due review when it has higher evidence priority than the next lesson.
2. Practice opens a finite due set.
3. Supported and independent results produce different evidence.
4. Exactly one 30 XP event is granted on qualifying completion.
5. Progress and the next recommendation update immediately.

### 24.3 Guided conversation

1. Learner selects a scenario tied to learned capabilities.
2. FastAPI validates identity, entitlement, allowance, scenario version, language configuration, and concurrency before resolving one `VoiceSessionSpec`.
3. The client receives only expiring connection material and starts the direct OpenAI Realtime voice-only path.
4. If the learner selects Show tutor and it is available, LiveAvatar renders the tutor without changing the application session, voice, scenario, or learning policy.
5. The UI accurately presents session lifecycle separately from turn and presentation state.
6. The coach stays on level and scenario, honors repeat/slower/hint requests, and avoids constant interruption.
7. The learner can mute, interrupt/stop the coach response, view captions, and end the session.
8. Show tutor being unselected or unavailable, or avatar failure, uses or returns to OpenAI audio + captions + static portrait without losing an otherwise healthy session or duplicating an applied event.
9. Cancel, timeout, disconnect, allowance expiry, and normal completion all stop the provider session and prevent orphaned connected-minute cost.
10. Reconnect, transcript processing, recap, evidence, and XP writes do not duplicate turns or rewards.
11. Completion is based on authored goals validated by GlideLingo, never by elapsed time or avatar/model assertion alone.
12. Recap separates successful communication, corrections, support, evidence, XP, and any pronunciation feedback that has independently valid audio evidence.

### 24.4 Cross-device/offline

1. Learner completes an available authored lesson offline.
2. Completion is visible locally and queued once.
3. On reconnect, the server accepts the idempotent events.
4. A second device displays the same completion/evidence/XP.
5. Re-delivery creates no duplicate rewards.

### 24.5 Subscription boundary

1. A free learner reaches a meaningful learning moment.
2. A locked AI/live feature clearly explains Pro value and usage allowance.
3. Purchase/restore updates verified entitlement across devices.
4. If live allowance ends, the active turn finishes safely and recap remains available.

---

## 25. V1 definition of done

V1 is done when:

- the five primary tabs work end to end on mobile and desktop/web;
- the Greek Foundations catalog contains complete authored content for every required lesson and checkpoint;
- Home always produces a valid, explainable next action;
- lessons, reviews, checkpoints, and guided conversations write truthful, synchronized evidence;
- XP, stars, rhythm, achievements, and celebrations follow the exact rules above;
- Practice recommendations are finite, relevant, and evidence-driven;
- Progress clearly distinguishes course completion, capability evidence, activity, and XP;
- at least the required guided voice experience passes reliability, latency, safety, privacy, and cost gates;
- avatar presentation never blocks or delays the learning conversation;
- subscription and usage limits are server-enforced and recover correctly;
- legacy routes preserve valid user journeys;
- automated tests cover deterministic curriculum/unlocks, idempotency, offline sync, entitlement, and live-session state transitions;
- manual QA covers accessibility, permissions, reconnect, empty/error/offline states, and the acceptance scenarios above.

The five-second test remains the final product check: on every primary screen, the learner can quickly tell **where they are, what they can do, why it matters, and what to do next**.
