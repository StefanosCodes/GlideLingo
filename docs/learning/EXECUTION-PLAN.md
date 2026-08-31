# Learning System Execution Plan

## Outcome

Turn the GlideLingo Learning Standard into one evidence-producing learning loop, then scale it into a reusable course-authoring and delivery system without generating a large inventory of unvalidated lessons.

## Current state

The repository currently has:

- a local course catalog and learner enrollment;
- a module path and structural course percentage;
- one authored Modern Greek lesson with bundled pronunciation audio;
- readable lesson blocks and a local answer check;
- a placeholder review surface;
- no durable attempts, capability evidence, mastery, scheduled review, or published course-version engine.

The existing Greek content is a prototype and validation input. It must be migrated through the same standard as future languages rather than being treated as the universal schema.

## Scope of this plan

Included:

- course and language-profile contracts;
- capability, mission, lesson, activity, evidence, and assessment contracts;
- deterministic content validation;
- one complete mission;
- attempt evidence, review, capability progress, and ethical motivation;
- authoring workflows and second-language portability validation.

Excluded until earned:

- a content-management studio;
- global competitive leagues;
- generalized XP or virtual currency;
- unconstrained AI-authored curricula;
- phoneme-level pronunciation scoring without language-specific validation;
- a full A1 or larger course inventory before the golden loop is validated.

## Slice 0: Learning contract — complete in documentation

### Outcome

Humans and coding agents share one definition of learning, progress, course structure, gamification boundaries, and publication quality.

### Deliverables

- `docs/learning/LEARNING-STANDARD.md`
- `docs/learning/COURSE-OUTLINE-TEMPLATE.md`
- this execution plan

### Acceptance

- Universal and language-specific responsibilities are separated.
- Completion, capability, consistency, and retained evidence are distinct.
- Deferred and prohibited gamification mechanics are explicit.
- The next implementation slice can define schemas without reopening the product model.

## Slice 1: File-backed course contracts and validator

### Outcome

One course can be represented as validated, versionable authored source rather than TypeScript constants and loosely structured lesson JSON.

### Deliverables

- schemas for course, language profile, capability, mission, lesson, activity, and assessment records;
- stable identifiers and version rules;
- deterministic validation command exposed through `package.json`;
- graph checks for missing references, cycles, reachability, and orphan capabilities;
- coverage report for four strands and communication modes;
- validation of audio and asset references;
- fixture tests containing both valid and intentionally invalid courses.

### Acceptance

- Existing Greek course metadata can be represented without hard-coding Greek concepts into universal fields.
- A missing prerequisite, cycle, duplicate ID, assessment leak, or audio reference fails with a precise location and message.
- Validation is read-only by default and produces deterministic output.
- The current application can continue loading its existing catalog until a later migration slice.

## Slice 2: One golden mission

### Outcome

A learner can complete one coherent, reviewed, mission-based episode using the entire learning cycle.

### Recommended mission

Use a first-meeting mission that ends with a short introduction and repair exchange. Script and pronunciation instruction become supporting capabilities rather than a disconnected gate.

### Deliverables

- approved language profile for Standard Modern Greek;
- capability and prerequisite records required by the mission;
- Encounter, Notice, Retrieve, Produce, Perform, and Revisit activities;
- input audio, speaking and non-speaking production paths, and written interaction where appropriate;
- practice items separated from a varied checkpoint;
- language, pragmatic, assessment, audio, and accessibility review records;
- structured content loaded by the current client.

### Acceptance

- The learner completes a real communicative job, not only an article and recognition question.
- Support visibly fades during the mission.
- Incorrect responses preserve dignity, explain the relevant contrast, and offer recovery.
- Interruption and resume behavior are testable.
- A qualified reviewer approves Greek naturalness and register.

## Slice 3: Deterministic learning-session evidence

### Outcome

Every meaningful activity attempt creates enough evidence to reproduce progression and feedback decisions.

### Deliverables

- explicit learning-session reducer or state machine;
- stable attempt identifier and idempotent submission contract;
- activity-version reference;
- support, retry, result, mode, and timing evidence fields;
- clear ready, active, feedback, retry, complete, interrupted, and error states;
- focused reducer and contract tests;
- persistence through the repository's authenticated backend path when that prerequisite is ready.

### Acceptance

- Replaying the same attempt cannot create duplicate evidence.
- Session position and feedback can be reconstructed from stored facts.
- Recognition, supported production, and independent production are distinguishable.
- The UI never marks a capability demonstrated from opening or merely completing a lesson.

## Slice 4: Review and capability progress

### Outcome

Learning evidence produces deterministic review needs and honest capability states.

### Deliverables

- initial evidence rules for introduced, practiced, demonstrated, and retained;
- deterministic review scheduling with bounded daily load;
- due-review read model and functioning Review route;
- Progress route showing path, capability, skill profile, and review state separately;
- delayed and varied checkpoint support;
- tests reproducing every capability transition from attempts.

### Acceptance

- Stored attempts reproduce progress and review decisions.
- A missed day changes neither completed work nor capability evidence.
- Course percentage is labeled structural progress.
- Review explains why an item returned and offers a recovery route after failure.

## Slice 5: Calm-momentum motivation

### Outcome

The product makes earned capability and sustainable consistency emotionally visible without introducing a reward economy.

### Deliverables

- capability milestone closure naming what changed;
- learner-chosen weekly practice cadence;
- flexible consistency display and warm lapse recovery;
- personal-best signals tied to support, transfer, or fluency;
- event instrumentation separating learning outcomes from engagement;
- reduced-motion, screen-reader, color-independent, and quiet-state behavior.

### Acceptance

- No empty tap, lesson opening, or arbitrary count unlocks an ability claim.
- The learner can understand the consistency rule before participating.
- A pause preserves learner identity and offers one small next action.
- Every experiment defines a learning metric, behavior metric, and harm guardrail.

## Slice 6: Portability validation

### Outcome

The standard can describe a second language with materially different requirements without schema forks or misleading equivalence.

### Selection criteria

Choose a language that challenges at least two Greek assumptions, such as:

- writing-system behavior;
- morphology or word-order patterns;
- register and address conventions;
- segmentation or tokenization;
- pronunciation and speech-evaluation support;
- availability of external standards and qualified reviewers.

### Deliverables

- second language profile;
- equivalent mission-family design, adapted rather than translated;
- validation report listing universal fields that held and assumptions that failed;
- minimal compatible schema changes with migration tests.

### Acceptance

- No universal field contains Greek-specific semantics.
- The second mission preserves the real-world outcome while using appropriate language-specific prerequisites and interaction patterns.
- Course validation and client rendering work without language-specific branching outside approved boundaries.

## Slice 7: Authoring skills and editorial workflow

### Outcome

Coding agents and human reviewers can produce new course content consistently from approved contracts.

### Initial authoring skills

1. **Course architect:** creates the course charter, language profile, capability graph, standards map, and coverage plan.
2. **Mission author:** turns an approved mission brief into lessons, activities, feedback, assessment candidates, and audio scripts.
3. **Course reviewer:** independently audits language, pragmatics, pedagogy, assessment, coverage, accessibility, and publication readiness.

Assessment review may become a separate skill when the volume and expertise justify it. Deterministic validation remains software invoked by the skills, not prose duplicated in their instructions.

### Acceptance

- Each skill has narrow inputs, outputs, authority, and stopping conditions.
- An author cannot approve the same artifact.
- Every factual or standards-dependent decision preserves provenance.
- Skills run the repository validator and surface failures without rewriting published content silently.
- A stable evaluation set detects language drift, schema violations, answer leakage, and unsupported progress claims.

## Slice 8: Scale course production

### Outcome

Reviewed missions can be produced in batches without reducing quality or bypassing evidence gates.

### Entry gate

Do not start until:

- the golden mission works in the product;
- delayed capability evidence is observable;
- the second-language portability test passes;
- authoring-skill evaluations are stable;
- the team knows which review work remains inherently human.

### Deliverables

- staged content batches organized by capability dependencies;
- reviewer capacity and turnaround expectations;
- coverage and duplicate-content reports;
- immutable course publication and migration maps;
- learner pilots at stage boundaries;
- rollback to the previous published course version.

## Verification ladder

For every slice, use the cheapest applicable evidence first:

1. schema and rule unit tests;
2. invalid-fixture tests;
3. reducer and state-transition tests;
4. content contract tests;
5. repository `npm run verify`;
6. real mission flow on mobile and Electron;
7. delayed learner-performance checks;
8. authoring-skill evaluation cases;
9. broader pilot and accessibility review.

Do not treat lesson completion, time in app, daily activity, or retention alone as proof that a learning slice succeeded.

## Research and experiment contract

Every learning or motivation experiment records:

- hypothesis and learner segment;
- eligibility and exclusion rules;
- fixed content or intervention version;
- primary learning metric;
- primary behavior metric;
- guardrail and harm metrics;
- comparison and observation window;
- minimum decision threshold;
- result that removes or redesigns the mechanic.

## Major risks

| Risk | Control |
| --- | --- |
| Producing a large weak course before the loop is validated | Golden-mission and learner-evidence gate |
| Treating Greek structure as universal | Language profile plus second-language portability slice |
| Optimizing retention instead of learning | Separate learning, behavior, and guardrail metrics |
| Inflated mastery from easy recognition | Support-aware evidence and unseen delayed checks |
| AI content drift | Immutable authored spine, independent review, validator, and eval set |
| Speaking claims exceeding provider capability | Language-specific evaluation and honest construct boundaries |
| Gamification displacing learner goals | Calm-momentum invariants and removal criteria |
| Content workflow becoming operationally heavy too early | File-backed authoring before a content studio |

## Immediate next action

Implement Slice 1 only: define the smallest schemas and deterministic validator required to represent the existing Greek prototype plus one redesigned golden mission. Do not author the remaining course lessons yet.

