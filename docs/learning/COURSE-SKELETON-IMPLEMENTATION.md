# Course Skeleton and Content Platform

Status: implementation contract for the reusable course skeleton
Scope: course flow, content package boundaries, authored-versus-live behavior, Greek population handoff, validation, and future authoring automation
First implementation case: English instruction -> Standard Modern Greek (`en-el-GR`)

## 1. Purpose

GlideLingo needs three distinct layers:

1. **Product shell** — Home, Course, Speak, Practice, Progress, Profile, navigation, account, subscription, and shared UI states.
2. **Course engine** — reusable rules that load a published course, unlock valid steps, render activities, record attempts, select review, and explain progress.
3. **Course substance** — language-specific capabilities, lessons, phrases, explanations, exercises, audio, scenarios, pronunciation targets, checkpoints, and review variants.

This document defines the boundary between the course engine and course substance so GlideLingo can first build one reliable skeleton, then populate Greek without rewriting the application, and later add another language through reviewed content rather than product forks.

It operationalizes the [Learning Standard](./LEARNING-STANDARD.md), [Course Outline Template](./COURSE-OUTLINE-TEMPLATE.md), [Execution Plan](./EXECUTION-PLAN.md), and root [Product Requirements](../../PRODUCT.md). Those documents remain authoritative for pedagogy, evidence, product scope, and release behavior.

## 2. Locked model

The reusable product contract is:

~~~text
Language research and learner needs
  -> reviewed language profile
  -> capability and prerequisite graph
  -> ordered stages and modules
  -> real-world missions
  -> lessons and activities
  -> checkpoints and guided conversations
  -> attempt evidence
  -> deterministic review
  -> retained capability
~~~

The skeleton controls structure and behavior. A published course package supplies language substance.

AI may help create course packages during authoring. AI must not invent the official course live for each learner.

## 3. Current repository reality

The consolidated Course MVP now implements the deterministic package and runtime boundary, while later content population and publication remain incomplete:

- `src/constants/catalog.ts` contains Greek, Spanish, and French language metadata plus one Greek A0–A1 catalog with 12 modules and 26 lesson records.
- `content/courses/en-el-GR/` contains one schema-valid authored golden lesson; all catalog-only lesson records are explicit unavailable placeholders.
- `src/features/learning-session/` renders the current lesson blocks/beats and provides saved audio playback.
- `src/features/learning-progress/` contains early deterministic evidence and rhythm policies.
- `content/courses/en-el-GR/` already has audio profiles, manifest, lock file, and generated-asset flow.
- Canonical Course v1 schemas, publication metadata, exact validation, a precompiled runtime schema boundary, and typed lookup maps are implemented.
- The compatibility catalog still supplies placeholder roadmap metadata around the single authored package; additional authored packages require explicit static registration.

A lesson title in the catalog is a placeholder, not a releasable lesson.

## 4. Authored, deterministic runtime, and delegated live boundaries

Every product behavior must belong to exactly one category.

| Concern | Authored before release | Deterministic at runtime | Generated live |
|---|---:|---:|---:|
| Course promise, stages, modules, order | Yes | Loaded exactly | No |
| Capability graph and prerequisites | Yes | Unlock evaluator | No |
| Lesson objectives and required sequence | Yes | Session state machine | No |
| Explanations, examples, target phrases | Yes | Rendered exactly | No |
| Correct answers and accepted alternatives | Yes | Scored by rules | No |
| Hints and core feedback contrasts | Yes | Selected by rules | No |
| Google lesson audio | Generated during authoring | Played/cached | No |
| Checkpoint pools and success rubrics | Yes | Deterministic selection/scoring | No |
| Guided scenario goal and completion rule | Yes | Validated by GlideLingo | AI performs the character/dialogue |
| Home next action | Inputs authored | Deterministic priority | AI may explain only |
| Practice/review queue | Item pools authored | Derived from evidence/time | No |
| Contextual lesson explanation | Grounded source authored | Request bounded by policy | Yes, optional |
| Live conversation | Scenario/context authored | Eligibility and outcome validated | Delegated to the voice platform |
| XP, evidence, stars, unlocks | Rules authored | Server/application authority | No |
| Pronunciation claims | Target/rubric authored | Confidence and eligibility gates | Only through a validated audio evaluator |
| Translations/localization | Reviewed before release | Rendered exactly | No required live generation |

### 4.1 Never generated live

The following may never depend on a live model response:

- official course order;
- required prerequisites;
- expected answer;
- core translation;
- checkpoint pass/fail;
- XP amount;
- evidence/star transition;
- unlock decision;
- pronunciation score;
- published lesson completion rule.

If AI is unavailable, authored lessons, saved audio, deterministic practice, checkpoints, progress, and offline-supported learning must continue.

## 5. Learner-facing course flow

### 5.1 Entry

1. Learner selects a published course.
2. The app loads the immutable course version.
3. Placement or entry assumptions determine the first reachable capability.
4. Home selects the single highest-priority valid action.
5. The learner may follow Home, browse Course, enter Practice, or enter an eligible Speak experience.

### 5.2 Core mission loop

A mission is a real-world job such as introducing yourself or ordering coffee.

~~~mermaid
flowchart TD
  A["Mission preview<br/>real-world outcome"]
  B["Learn<br/>Encounter + Notice"]
  C["Practice<br/>Retrieve + Produce"]
  D["Perform<br/>checkpoint or conversation"]
  E["Revisit<br/>review + retention"]

  A --> B
  B --> C
  C --> D
  D --> E
  E -->|"needs strengthening"| C
~~~

Required phases:

1. **Preview:** Explain the practical job, expected time, required modalities, and what success means.
2. **Encounter:** Hear/read meaningful target language with high support.
3. **Notice:** Focus on meaning, sound, form, cultural use, or a useful contrast.
4. **Retrieve:** Recall meaning or form without simply copying.
5. **Produce:** Say, write, select, or construct the language with fading support.
6. **Perform:** Complete a fresh bounded task or guided conversation.
7. **Close:** Explain what changed, what evidence exists, support used, XP, and next action.
8. **Revisit:** Return later through varied review to test retention.

A mission may span several short lessons. A lesson does not need every phase, but the mission package must provide the complete loop.

### 5.3 Learner choices

At valid boundaries, the learner may:

- continue the recommended mission;
- replay a completed lesson;
- practice due or weak capabilities;
- select a skill-focused practice mode;
- enter an unlocked guided conversation;
- use Just Talk within their demonstrated level;
- pause and resume at the last safe activity boundary;
- use non-speaking alternatives when microphone access is unavailable.

These choices do not bypass authored prerequisites or manufacture evidence.

## 6. Course package contract

Each instruction-language/target-language course has one versioned package:

~~~text
content/courses/<instruction>-<target>/
  course.json
  language-profile.json
  capabilities.json
  modules.json
  missions/
    <mission-id>.json
  scenarios/
    <scenario-id>.json
  pronunciation/
    targets.json
    feedback-rules.json
  review/
    review-policy.json
    item-pools.json
  audio-profiles.json
  audio-manifest.json
  audio-lock.json
  sources.json
  publication.json
~~~

The exact split may be refined while implementing schemas, but these logical records must remain distinct. Do not collapse the full course into one unreviewable file.

### 6.1 `course.json`

Required fields:

- schema version;
- course ID and immutable content version;
- instruction and target locale;
- target variety/register;
- learner segment and entry assumptions;
- intended proficiency range;
- bounded product promise;
- exit capability IDs;
- module/stage order;
- placement policy;
- transliteration policy;
- keyboard/input policy;
- supported product capabilities;
- publication reference.

### 6.2 `language-profile.json`

Required fields:

- writing system;
- sound/pronunciation priorities;
- transliteration and script-support policy;
- morphology/syntax progression notes;
- lexical selection policy and sources;
- formulaic language policy;
- politeness, address, register, and pragmatic norms;
- regional variation and accepted alternatives;
- cultural settings and representation rules;
- speech/TTS/ASR constraints;
- accessibility/input constraints;
- external proficiency/teaching references;
- required reviewer qualifications;
- known limitations.

Universal schemas must hold these fields without encoding Greek-specific rules into the engine.

### 6.3 `capabilities.json`

Each capability defines:

- stable ID and version;
- learner-facing can-do statement;
- domain/situation;
- communication modes;
- prerequisite capability IDs;
- required linguistic resources;
- pragmatic/cultural resources;
- teaching mission IDs;
- practice evidence;
- demonstration criteria;
- retention criteria;
- permitted support;
- source/provenance references.

The validator must reject missing prerequisites, cycles, unreachable exit capabilities, and capabilities taught or assessed only once.

### 6.4 `modules.json`

Each module defines:

- stable ID and version;
- stage;
- learner-facing transformation;
- target/supporting capabilities;
- prerequisites;
- new and recycled resources;
- likely learner errors;
- cultural/pragmatic focus;
- ordered mission IDs;
- checkpoint ID;
- delayed-review dependencies;
- estimated time;
- recommended guided scenario IDs.

### 6.5 Mission package

Each mission defines:

- stable ID/version and title;
- real-world job;
- learner and other roles;
- target/supporting capabilities;
- prerequisites;
- completion condition;
- lesson order;
- activity references or embedded versioned activities;
- Encounter/Notice/Retrieve/Produce/Perform/Revisit coverage;
- support-fading plan;
- checkpoint pool;
- review item pool;
- interruption/resume behavior;
- offline capability;
- accessibility alternatives;
- asset/audio references;
- reviewer/provenance references.

### 6.6 Lesson record

Each lesson defines:

- stable ID/version;
- parent mission;
- immediate outcome;
- one primary learner action;
- entry state;
- duration;
- activity sequence;
- new/recycled material;
- feedback/retry behavior;
- completion condition;
- safe resume boundaries;
- audio/image/interaction assets.

Lesson length must follow learning value, not artificial step counts.

### 6.7 Activity record

Each activity defines:

- stable ID/version;
- supported activity renderer type;
- instruction and prompt;
- target/supporting capability IDs;
- communication mode;
- input contract;
- accepted response or rubric;
- meaningful distractors;
- authored feedback contrasts;
- support/hints;
- retry/skip behavior;
- evidence eligibility;
- practice-only versus assessment-eligible;
- accessibility behavior;
- asset references.

### 6.8 Guided scenario record

Each scenario defines:

- stable ID/version;
- course/module/capability relationship;
- setting and learner goal;
- role/persona;
- language level and allowed resources;
- authored opening;
- hint ladder;
- correction policy;
- target turn range and maximum duration;
- success observations;
- deterministic completion rule;
- evidence mapping;
- safe exits;
- `conversationProfileId` referencing a provider-neutral conversation policy owned by the voice platform.

The model may vary dialogue. It may not change the goal or declare official completion.

### 6.9 Pronunciation target

Each eligible target defines:

- text and locale;
- target variety;
- syllable segmentation where applicable;
- stress target;
- internal phonetic representation when reviewed;
- target audio IDs;
- acceptable variants;
- common source-language learner errors;
- feedback codes/templates;
- assessment eligibility;
- evaluator/model version requirement;
- confidence threshold;
- reviewer/sign-off record.

A target may exist for listening/self-comparison before automated assessment is allowed.

### 6.10 Publication record

Required fields:

- immutable course version;
- source revision;
- schema versions;
- content hash;
- creation/generation provenance;
- automated validator report;
- curriculum review;
- instructional-design review;
- language/pragmatics review;
- independent assessment review;
- audio/platform QA;
- accessibility review;
- learner-pilot evidence;
- known limitations;
- migration compatibility;
- published/retired timestamps.

Only a valid published record makes a course visible as available.

## 7. Universal activity renderer set

The skeleton must support content-driven renderers rather than lesson-specific screens.

Required initial renderer contracts:

| Renderer | Learner action | Can be assessment-eligible |
|---|---|---:|
| `explain` | Read/hear a bounded explanation | No |
| `listen_choose` | Hear audio and select meaning/form | Yes |
| `match` | Match target and meaning/sound | Practice by default |
| `order_phrase` | Arrange tokens into an authored phrase | Yes |
| `type_response` | Enter a bounded written response | Yes |
| `script_recognition` | Identify letter/grapheme/sound | Yes |
| `listen_repeat` | Hear and record/repeat | Only with eligible evaluator |
| `controlled_speak` | Produce a bounded spoken answer | Meaning evidence; pronunciation separately |
| `mini_roleplay` | Complete one authored conversational turn | Yes under scenario rubric |
| `checkpoint_item` | Perform a fresh/varied task | Yes |
| `reflection` | Review explanation or compare recording | No |

Renderer-specific fields belong in discriminated schemas. Unknown renderer types must fail validation rather than render a blank card.

## 8. Runtime engine requirements

### 8.1 Loader

The loader must:

- load only published compatible course versions in production;
- validate schemas before use;
- build lookup maps for courses, modules, missions, lessons, activities, capabilities, scenarios, and assets;
- reject duplicate IDs and unresolved references;
- expose typed read APIs;
- avoid importing individual Greek lesson files into universal product code;
- preserve an explicit migration bridge while `src/constants/catalog.ts` is retired.

### 8.2 Unlock evaluator

The evaluator must:

- start from entry/placement state;
- evaluate authored prerequisite IDs;
- unlock only valid next lessons/missions/checkpoints;
- keep optional practice and Speak entry separate from official progression;
- preserve replay access;
- explain why content is locked;
- never use XP or model output as an unlock condition.

### 8.3 Session state machine

Required states:

~~~text
ready
active
feedback
retry
paused
interrupted
complete
error
~~~

Every transition must be reproducible from course/activity versions and attempt facts. Resume occurs only at declared safe boundaries.

### 8.4 Attempt and evidence contract

Every scored attempt records:

- stable attempt/event ID;
- learner/course/session correlation;
- course, mission, lesson, activity, and capability versions;
- prompt/item variant;
- learner response representation;
- result;
- communication mode;
- support/hints used;
- retry count;
- timing;
- platform/app version;
- evidence eligibility;
- idempotency key.

Completion, XP, evidence, demonstration, and retention remain separate derived outcomes.

### 8.5 Review engine

Review must:

- derive due items from evidence and time;
- select from authored eligible pools;
- vary context or mode where required;
- cap daily burden;
- distinguish supported and independent retrieval;
- return a failed capability to a clear recovery path;
- never invent unreviewed teaching content live.

## 9. Greek skeleton population plan

The current Greek catalog is a useful preliminary capability order, not automatically approved pedagogy.

### 9.1 Proposed stage mapping

| Stage | Current Greek modules to validate/adapt | Required performance |
|---|---|---|
| Access | Letters/sound map plus repair language | Decode essential patterns and ask for repetition/help |
| First contact | Introduce yourself, origin, personal information | Complete a short first meeting |
| Everyday needs | Café, numbers/prices, shopping | Complete a basic service interaction |
| Place and movement | Directions, travel/lodging | Obtain/follow essential location or travel information |
| Personal world and plans | Family, routine, make a plan | Describe familiar life and coordinate a simple plan |
| Integrated milestone | New combined mission | Transfer prior capabilities in a fresh bounded situation |

Greek content authors may reorder, merge, split, or replace current modules after the language profile and capability graph are reviewed. IDs require an explicit migration map once published.

### 9.2 Greek package completion checklist

Greek Foundations is populated only when:

- Standard Modern Greek language profile is approved;
- exit capability graph is complete and acyclic;
- every module has a practical transformation and checkpoint;
- every placeholder lesson has complete activities, feedback, recovery, and assets;
- each mission covers the complete learning cycle across its lessons;
- every target phrase has reviewed meaning, usage, register, and audio;
- every guided scenario has authored goals and deterministic completion;
- practice and assessment pools are separated;
- review variants exist;
- pronunciation targets distinguish self-comparison from assessment eligibility;
- all Google audio manifests validate;
- native-language/pragmatic review is signed;
- assessment and accessibility reviews pass;
- a learner pilot supports the stage claims;
- an immutable publication record exists.

## 10. AI-assisted authoring workflow

Course content is generated during authoring, reviewed, and published. It is not improvised in production.

~~~text
Research dossier
  -> language profile
  -> capability graph
  -> course/stage/module plan
  -> mission briefs
  -> lesson/activity/scenario drafts
  -> pronunciation/audio package
  -> deterministic validation
  -> independent human review
  -> immutable publication
~~~

### 10.1 AI may

- collect and summarize cited language/pedagogy sources;
- draft language-profile candidates;
- propose capability graphs and dependencies;
- draft mission/lesson/activity/scenario candidates;
- create distractor, feedback, and review variants;
- prepare audio scripts and pronunciation metadata candidates;
- run repository validators;
- produce coverage and reviewer packets.

### 10.2 AI may not

- publish its own output;
- certify naturalness, pragmatics, dialect, culture, or assessment validity;
- silently change a published graph;
- generate official answers at learner runtime;
- invent evidence;
- approve pronunciation scoring;
- approve its own authored artifact.

Every standards-dependent or factual decision preserves source provenance.

## 11. Future course-authoring skill

Do not create the skill until the schemas, validator, and one golden Greek mission are stable.

The future repository skill should be named clearly, such as `course-authoring`, and should orchestrate three narrow roles:

1. **Course architect:** research dossier, language profile, capability graph, standards map, course/stage/module plan.
2. **Mission author:** mission, lessons, activities, feedback, scenario, checkpoint/review candidates, and audio scripts.
3. **Course reviewer:** independent audit of schema, coverage, language/pragmatics, pedagogy, assessment, accessibility, assets, and publication readiness.

Inputs:

- target/instruction language;
- target variety/register;
- learner segment;
- proficiency range;
- product goals;
- approved sources;
- repository course/schema version.

Outputs:

- cited research dossier;
- language profile;
- capability graph;
- course/module/mission packages;
- pronunciation/audio package;
- validation report;
- review checklist;
- explicit blockers.

Stopping conditions:

- required sources unavailable;
- schema failure;
- unresolved prerequisite graph;
- unsupported assessment/pronunciation claim;
- missing qualified reviewer;
- request to modify published content without a new version/migration.

The skill invokes deterministic scripts. It must not duplicate validator logic in prose.

## 12. Proposed implementation locations

The Course MVP implements these runtime and authoring boundaries; later slices should extend them without bypassing validation:

~~~text
content/
  schemas/                         # universal JSON Schemas
  fixtures/                        # valid and intentionally invalid test courses
  courses/en-el-GR/                # reviewed Greek package

scripts/course-content/
  validate.*                       # schema/reference/graph/coverage/assets
  report.*                         # deterministic authoring/review reports

src/features/course-catalog/
  model/                           # generated/inferred TypeScript contracts
  loader/                          # file-backed published package loader
  selectors/                       # course/module/mission lookup and next step
  __tests__/

src/features/learning-session/     # generic activity renderers and state machine
src/features/learning-progress/    # attempts, evidence, review, capability states
src/app/course/                    # thin routes
src/app/lesson/                    # thin routes

backend/app/modules/learning/      # server persistence/sync when that slice begins
~~~

Rules:

- do not create a content-management service before file-backed editorial workflow is proven;
- do not place new course substance in `src/constants/catalog.ts`;
- do not create Greek-specific branches in universal renderer/evidence code;
- do not move deterministic learning authority into the lesson tutor or voice model;
- use platform files only when native and web implementation genuinely differs.

## 13. Implementation slices

### Slice 0 — schemas and fixtures

Deliver:

- universal schemas for every record in section 6;
- stable identifier/version rules;
- one minimal valid fixture language;
- invalid fixtures for duplicate IDs, missing refs, cycles, leaks, bad assets, and unsupported renderer types;
- `npm run course:validate` read-only deterministic command.

Gate: errors identify exact file/path/field and CI can run without external-service credentials.

### Slice 1 — loader bridge

Deliver:

- typed course loader;
- lookup/selectors;
- compatibility adapter exposing current catalog behavior;
- Greek `el-letters-1` represented by the new package;
- no UI redesign.

Gate: current first lesson renders and saved audio works through the new contract with behavior preserved.

### Slice 2 — golden Greek mission

Deliver one complete first-meeting mission:

- reviewed Greek language-profile slice;
- capability prerequisites;
- Encounter through Revisit activities;
- saved audio;
- speaking and non-speaking paths;
- varied checkpoint;
- guided scenario definition;
- review variants;
- review/sign-off records.

Gate: a learner completes a real introduction job; support fades; a Greek reviewer approves naturalness/register.

### Slice 3 — generic course progression

Deliver:

- course/module/mission read models;
- authored prerequisite unlock evaluator;
- resume/replay;
- locked explanations;
- checkpoint transition;
- deterministic Home next action input.

Gate: progression is reproducible and no model/XP can unlock a step.

### Slice 4 — attempts, review, and progress

Deliver:

- session state machine;
- idempotent attempt events;
- evidence derivation;
- review scheduling and item selection;
- Progress read model;
- offline queue/sync contract.

Gate: stored facts reproduce every result, review recommendation, and evidence state.

### Slice 5 — full Greek population

Deliver content in reviewed dependency-ordered batches:

1. Access;
2. First contact;
3. Everyday needs;
4. Place and movement;
5. Personal world and plans;
6. Integrated milestone.

Gate per batch: validation, native review, assessment review, audio QA, accessibility, pilot, and immutable publication.

### Slice 6 — authoring automation and portability

Deliver:

- authoring/reviewer skills after workflows stabilize;
- second-language profile and one equivalent adapted mission;
- portability report;
- minimal schema migrations if justified.

Gate: a second language loads without Greek-specific universal code and preserves its own linguistic/pragmatic needs.

## 14. Agent implementation rules

An implementation agent working from this specification must:

1. read `AGENTS.md` and the learning documents first;
2. start with the smallest vertical slice;
3. avoid UI redesign during schema/loader migration;
4. preserve the working `el-letters-1` path;
5. add invalid fixtures before expanding validators;
6. keep validation deterministic and provider-free;
7. show exact schema and graph failures;
8. add tests for every state/transition and migration boundary;
9. update documentation when a contract changes;
10. stop when a change would require unreviewed pedagogy or language judgment.

The agent must not populate Greek with invented final content merely to make tests pass. Fixtures must be labeled fixtures; placeholders cannot pass publication gates.

## 15. Acceptance scenarios

### 15.1 Add a course package without product changes

1. Author creates a valid unpublished fixture package.
2. Validator accepts its schemas and graph.
3. Production loader does not expose it because publication is absent.
4. A valid publication record is added.
5. The loader can display it without adding a new language union or editing navigation/renderers.
6. Unsupported activities fail before runtime.

### 15.2 Complete one Greek mission

1. Home recommends the first reachable mission.
2. Learner sees the real-world outcome.
3. Lesson activities move from supported input to production.
4. Saved Google audio plays with no live provider.
5. Learner exits and resumes at a safe boundary.
6. Fresh checkpoint records supported/independent evidence correctly.
7. Guided scenario becomes eligible according to authored rules.
8. Completion updates the next valid step and review queue once.

### 15.3 Live AI unavailable

1. Learner opens a fully authored mission.
2. Contextual tutor and live conversation are unavailable.
3. All required authored lesson activities and saved audio continue.
4. The app does not fabricate AI feedback.
5. Required completion remains possible unless the mission explicitly requires an online guided scenario; that requirement must be disclosed before start.

### 15.4 Broken content

The validator rejects:

- missing capability;
- prerequisite cycle;
- duplicate ID/version;
- unknown renderer;
- answer absent from accepted contract;
- assessment item leaked into practice;
- missing audio clip;
- scenario without deterministic completion;
- pronunciation assessment without an eligible evaluator;
- published package without required reviews.

### 15.5 Replace Greek with a portability fixture

A second fixture with different writing, morphology, register, or segmentation must load through the same engine. Language-specific behavior comes from the profile/content and approved adapter boundaries, not copied Greek assumptions.

## 16. Definition of done

### Skeleton complete

The reusable skeleton is complete when:

- universal schemas and validator exist;
- published course packages load through one typed boundary;
- current Greek content no longer requires course substance in TypeScript constants;
- generic renderers cover required V1 activity types;
- progression, attempts, evidence, review, and resume are deterministic;
- authored lessons work without live AI;
- the golden Greek mission passes end to end;
- one portability fixture proves the engine is not Greek-specific.

### Greek content complete

Greek Foundations is complete only when every required stage, mission, lesson, activity, checkpoint, scenario, review pool, pronunciation target, audio asset, and publication gate in section 9 is satisfied. A complete skeleton with placeholder Greek lessons is not a complete Greek course.

### Course-production system complete

The production system is complete when reviewed course batches can be generated with AI assistance, deterministically validated, independently approved, versioned, published, rolled back, and loaded without changing application code.

## 17. Explicit non-goals of this documentation slice

This specification does not:

- implement schemas, loaders, routes, backend persistence, or UI;
- generate or approve the remaining Greek course content;
- create the authoring skill;
- approve a pronunciation evaluator;
- add another language;
- merge any pull request.

It gives the next implementation agent an exact skeleton contract and a safe sequence for turning that skeleton into a complete Greek course.
