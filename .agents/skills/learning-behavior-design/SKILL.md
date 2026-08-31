---
name: learning-behavior-design
description: Design or audit ethical gamification, emotional UX, retention mechanics, lifecycle messaging, and learner motivation for GlideLingo. Use for streaks, goals, progress, celebrations, rewards, lesson feedback, onboarding, return loops, notifications, or research synthesis; do not use for visual styling alone or curriculum pedagogy alone.
---

# Learning Behavior Design

Help the learner take the next useful learning action and feel genuine, accumulating capability. Treat engagement as a means to durable language learning, not the product outcome by itself.

## GlideLingo north star

Design for **calm momentum**: the learner feels oriented, capable, curious, and welcomed back. Preserve GlideLingo's restrained visual system and evidence-first progress model. Do not copy another product's mascot, reward economy, visual language, or pressure tactics.

Before proposing a mechanic, inspect the relevant route, state, content, and `DESIGN_SYSTEM.md`. Read [references/glidelingo-journey.md](references/glidelingo-journey.md) for the current emotional journey and product-specific boundaries.

## Frame the request

Separate these concerns explicitly:

- **Learning outcome:** the language ability that should improve.
- **Target behavior:** one observable action the learner should take next.
- **Journey moment:** when and where the intervention appears.
- **Emotional transition:** what the learner may feel before and what the design should help them feel after.
- **Mechanism:** why the proposed detail should influence that behavior or emotion.
- **Evidence:** what supports the mechanism and what remains an assumption.

If a missing product choice would materially change the design, ask a focused question. Otherwise state a reasonable assumption and continue.

## Choose the working mode

### Audit an existing experience

Trace the relevant journey before judging an isolated screen. Identify the intended action, current emotional signal, competing signals, friction, recovery behavior, accessibility, and whether the interface represents learning truthfully. Report concrete findings before recommendations.

### Design a mechanic or emotional beat

Read [references/mechanic-patterns.md](references/mechanic-patterns.md), then write a behavior design brief using [references/behavior-brief.md](references/behavior-brief.md). Specify the smallest coherent intervention, including copy, timing, visual emphasis, motion or haptics when relevant, edge states, and the next transition.

### Synthesize research or references

When the user supplies papers, links, notes, screenshots, interviews, analytics, or competitor examples, read [references/research-intake.md](references/research-intake.md). Preserve provenance, distinguish evidence from interpretation, record contradictions, and update [references/research-ledger.md](references/research-ledger.md) only with claims that change product decisions.

### Plan an experiment

Define the behavior hypothesis, learner segment, eligibility and exclusion rules, primary learning metric, primary behavior metric, guardrail metrics, instrumentation events, comparison, duration or stopping rule, and the decision each result would support. Never call a retention lift a learning improvement without learning evidence.

## Required design checks

- Tie rewards to meaningful effort, strategy, recovery, or demonstrated ability. Do not reward empty taps or inflate progress.
- Keep progress permanent when learning is permanent. A missed day must not erase mastery, completed work, or learner identity.
- Treat streaks as habit representations, not proof of ability. Prefer learner-chosen cadence, flexible consistency windows, honest repair, and a warm lapse-recovery path.
- Make feedback informational: explain what worked, what changed, and what to try next. Avoid praise that is unrelated to performance.
- Scale celebration intensity with effort, rarity, and meaning. Frequent wins should be brief; major milestones may create a memorable pause.
- Use surprise in content or expression, not in prices, permissions, progress rules, or reward odds.
- Keep competition and social exposure opt-in. Never fabricate scarcity, social proof, people, rankings, or activity.
- Do not use shame, threats, fake urgency, hostage mechanics, confusing currencies, or notifications that imply a relationship the product does not have.
- Provide quiet, reduced-motion, screen-reader, Dynamic Type, and color-independent expressions of every emotional state.
- Design loading, empty, success, error, cancellation, offline, interruption, return, and lapse states as part of the same emotional sequence.

## Output quality

Prefer one strong, testable direction plus a bounded alternative over a list of disconnected gamification ideas. Make the small details executable: exact state trigger, hierarchy, copy intent, animation amplitude and duration, sound or haptic role, dismissal behavior, repetition cap, and recovery path.

End with:

- what learner truth the design makes visible;
- the riskiest assumption;
- how success and harm will be observed;
- what should remain deliberately plain.

