# GlideLingo Learning System

This folder defines how every GlideLingo language course should be designed, authored, assessed, personalized, and represented to learners.

The learning system is language-independent. Greek is the first implementation and validation case; it is not the template from which every language is mechanically copied.

These documents describe the intended product contract. They do **not** claim that mastery, attempt evidence, scheduled review, adaptive sequencing, authoring skills, or the complete content pipeline already exist.

## Read this documentation in order

1. [Learning standard](./LEARNING-STANDARD.md) defines the evidence-backed principles and non-negotiable product invariants.
2. [Course outline template](./COURSE-OUTLINE-TEMPLATE.md) defines the reusable structure for a course, stage, module, mission, lesson, activity, and checkpoint.
3. [Course skeleton implementation](./COURSE-SKELETON-IMPLEMENTATION.md) defines the executable boundary between the reusable course engine and language-specific substance, including live-versus-authored behavior and the Greek population handoff.
4. [Execution plan](./EXECUTION-PLAN.md) turns the standard into small vertical slices with acceptance gates.
5. [Calm-momentum slice](./CALM-MOMENTUM-SLICE.md) records the first implemented evidence, review, and weekly-consistency behavior contract.
6. [Calm-momentum visual](./CALM-MOMENTUM-VISUAL.md) records the black/white canvas plus a light-blue accent and a narrow gradient exception.

The infrastructure and application delivery direction remains in [`../infra/`](../infra/README.md). The learning documents own curriculum and learner-evidence meaning; the infrastructure documents own application and system boundaries.

## Settled direction

GlideLingo uses a capability-first, mission-based learning model:

```text
External proficiency references + learner needs
  -> language-specific profile
  -> capability and prerequisite graph
  -> real-world missions
  -> lessons and activities
  -> attempts and feedback
  -> capability evidence
  -> review and retained performance
```

The learner sees a calm, understandable path through this graph. The system may personalize practice, but it must not silently change official course outcomes, prerequisites, mastery rules, or progress claims.

## Source-of-truth boundaries

| Concern | Source of truth |
| --- | --- |
| What a learner should be able to do | Published course capability graph |
| What content teaches that capability | Published versioned missions and activities |
| What the learner attempted | Append-only attempt evidence, once implemented |
| What progress means | Deterministic evidence rules |
| What should be reviewed | Deterministic review policy derived from evidence and time |
| What appears next | Course prerequisites plus bounded personalization |
| What keeps the learner returning | Ethical behavior design supporting meaningful practice |

## Working vocabulary

- **Capability:** an observable use of language, such as asking for repetition or arranging a meeting.
- **Mission:** a bounded real-world job that requires one or more capabilities.
- **Lesson:** a short authored learning episode serving a mission.
- **Activity:** one learner interaction that teaches, practices, or assesses a target.
- **Evidence:** an attempt record interpreted in context, including mode, support, task familiarity, and delay.
- **Authoring skill:** a Codex workflow that creates or reviews course artifacts. This is different from a learner capability.

## Change rule

Do not scale lesson production or create a content-management studio before the standard has been validated with:

1. one complete reviewed mission;
2. real learner attempts and delayed checks;
3. one second language that exposes different script, morphology, syntax, or pragmatic requirements.
