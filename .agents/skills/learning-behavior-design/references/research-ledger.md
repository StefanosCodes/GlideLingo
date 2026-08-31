# Research ledger

This is a maintained decision aid, not an exhaustive gamification bibliography. Re-check source details before consequential product decisions.

## Motivation: support needs, not just rewards

**Claim:** Environments that support autonomy, competence, and relatedness are associated with healthier self-motivation and well-being. These needs are a useful lens for judging a mechanic, not a promise that any feature satisfying the labels will work.

- Evidence: Ryan and Deci, “Self-Determination Theory and the Facilitation of Intrinsic Motivation, Social Development, and Well-Being” (2000), [author-hosted paper](https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf).
- Product implication: check whether a mechanic gives meaningful choice, informative evidence of growing ability, or honest connection. Avoid controlling pressure disguised as motivation.
- Limitation: SDT is a broad theory. A concrete interface still needs a specific mechanism and product validation.

## Gamification is not one treatment

**Claim:** Gamified learning has shown positive average effects across cognitive, motivational, and behavioral outcomes, but results vary with design and context; motivational and behavioral findings were less stable in higher-rigor subsets than cognitive findings.

- Evidence: Sailer and Homner, “The Gamification of Learning: a Meta-analysis” (2020), [DOI](https://doi.org/10.1007/s10648-019-09498-w).
- Product implication: never justify a feature with “gamification works.” Name the element, mechanism, outcome, and context, then measure them separately.
- Limitation: heterogeneous interventions and study settings limit direct prediction for GlideLingo.

**Claim:** Specific game elements can affect different psychological experiences; an experimental study found different patterns for badges, leaderboards, performance graphs, avatars, story, and teammates, while intended autonomy effects did not automatically appear.

- Evidence: Sailer et al., “How gamification motivates” (2017), [DOI](https://doi.org/10.1016/j.chb.2016.12.033).
- Product implication: select elements for a defined emotional job. Do not assume adding choice or a reward produces autonomy.
- Limitation: an online simulation is not a language-learning app or a long-term field setting.

## Streaks can become a competing goal

**Claim:** Across seven studies, the representation of an intact versus broken logged streak influenced later engagement independently of the underlying past behavior. Repair attenuated the negative effect of a broken streak, and the studies included language-learning tasks.

- Evidence: Silverman and Barasch, “On or Off Track: How (Broken) Streaks Affect Consumer Decisions” (2023), [DOI](https://doi.org/10.1093/jcr/ucac029).
- Product implication: a streak can motivate return, but it can also replace the learner's actual goal. Use transparent counting, flexible cadence, and lapse recovery; measure learning and post-lapse return.
- Limitation: experimental logs and a fitness field dataset do not establish the best long-term streak design for GlideLingo.

## Learning requires retrieval and time

**Claim:** Spacing and retrieval practice improve long-term learning, and the useful schedule depends on the desired retention interval.

- Evidence: Carpenter et al., “The science of effective learning with spacing and retrieval practice” (2022), [DOI](https://doi.org/10.1038/s44159-022-00089-1); Cepeda et al., “Spacing Effects in Learning” (2008), [DOI](https://doi.org/10.1111/j.1467-9280.2008.02209.x); Karpicke and Roediger, “The Critical Importance of Retrieval for Learning” (2008), [DOI](https://doi.org/10.1126/science.1152408).
- Product implication: motivate learners toward effortful, scheduled recall—not only easy daily activity. Reward returning to weak material and successful recovery as meaningful progress.
- Limitation: optimal schedules and activity forms depend on material, delay, and learner evidence.

## Plans can bridge intention and action

**Claim:** If-then implementation intentions linking a cue to a goal-directed action had a medium-to-large average effect on goal attainment in a meta-analysis of 94 independent tests.

- Evidence: Gollwitzer and Sheeran, “Implementation Intentions and Goal Achievement” (2006), [DOI](https://doi.org/10.1016/S0065-2601(06)38002-1).
- Product implication: learner-chosen “when/where, then practice” plans may be more respectful and useful than generic reminder pressure. The reminder should reconnect the learner to their own plan.
- Limitation: effects vary by domain and implementation; a plan is not a substitute for motivation, opportunity, or usable lesson design.

## Production engagement evidence does not prove learning

**Claim:** Duolingo reported deploying a bandit system for recurring practice reminders and measured substantial engagement lifts at large scale.

- Evidence: Yancey et al., “A Sleeping, Recovering Bandit Algorithm for Optimizing Recurring Notifications” (KDD 2020), [Duolingo Research paper](https://research.duolingo.com/papers/yancey.kdd20.pdf).
- Product implication: timing and message selection can change practice behavior, so notification policies deserve experimentation and strict frequency, relevance, and opt-out guardrails.
- Limitation: the reported reward was engagement, not language mastery or learner well-being. It does not justify copying the system or its objective.

