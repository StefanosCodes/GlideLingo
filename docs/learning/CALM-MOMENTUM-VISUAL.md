# Calm-momentum visual: black, white, light-blue accent

## Decision

Keep the black-and-white tool. Add one light-blue accent, and allow a quiet light-blue wash only on the surfaces that answer “what should I do now?” or “what just became yours?”

This is not a palette rewrite, not Duolingo green, not a mascot, and not XP. The canvas stays zinc. The primary button stays black. Blue is the extra feel, used sparingly so it still means something.

## Learner and moment

- **Learner:** a self-directed beginner on Home, looking at the next Greek quest.
- **Entry:** Home first; the same accent language then appears in the sitting (correct / recover / close) and on a demonstrated-capability card.
- **Before:** the page is correct and calm, but emotionally mute. Everything is the same gray, so the next step does not feel alive.
- **After:** the next action is obvious without shouting. The rest of the product still reads as a clean instrument.

## What we are not changing

- Zinc background, black text, hairline borders, Inter, compact radii.
- Black primary CTA (`theme.tint` on `GlideButton` primary).
- Existing state colors: green = confirmed / correct, gold = attention / chosen rhythm, red = danger / incorrect.
- Copy. “8 focused minutes. One clear next step.” stays.
- Evidence rules. Blue never means mastery. A wash on Home is invitation, not a claim that the capability is retained.
- No XP, gems, hearts, owl, path-of-circles, treasure chests, or decorative glass.

## Why a simpler presentation is insufficient

Home already has one primary action. It still *looks* like every other card. Color and a short wash give the current quest a temperature without adding competing rewards. If we recolor buttons, nav, and lists at the same time, the accent becomes wallpaper and the cleanliness is gone.

## Accent language

Blue is **invitation and proximity**. It marks the live learning moment.

| Role | Color job | Not used for |
| --- | --- | --- |
| Black / white | Structure, type, primary action | “Fun” |
| Light blue | Next useful action, progress toward it, selected-now | Mastery, success, failure |
| Green | Correct, demonstrated | Brand chrome |
| Gold | Chosen weekly rhythm only | Ability |
| Coral / red | Incorrect, destructive | Shame theater |

### Proposed tokens

Add semantic roles in `src/constants/theme.ts`. Screens still do not invent hex values.

Light:

- `accent`: `#38BDF8` — sky, visible on white, not navy
- `accentStrong`: `#0EA5E9` — progress fill, so the bar has contrast
- `accentSoft`: `#F0F9FF` — selected / wash floor
- `accentMid`: `#E0F2FE` — gradient stop

Dark:

- `accent`: `#38BDF8`
- `accentStrong`: `#7DD3FC`
- `accentSoft`: `#0B1724`
- `accentMid`: `#0F2438`

These sit beside the existing zinc roles. They do not replace `tint`, `success`, or `warning`.

### Gradient rule

`DESIGN_SYSTEM.md` currently forbids gradients. This slice opens **one** exception:

A single linear wash, two stops, low contrast, on allowlisted surfaces only.

- Light: `180deg`, `#FCFCFC` → `#E0F2FE`
- Dark: `180deg`, `#18181B` → `#0F2438`
- Opacity of the blue stop stays high enough to notice, low enough that type remains black-on-white.
- No third color, no radial glow, no ambient blobs, no glass.

If reduced motion is on, the wash may remain static. It must not animate in a loop.

Allowlist:

1. Home current-quest / strengthen card
2. Lesson closure / first `Demonstrated` capability card

Everywhere else stays flat zinc.

## Structure: what actually changes

**The page skeleton does not change.** Same sidebar, same main column, same four blocks, same order, same copy. We are not adding a Duolingo right rail, a circular lesson path, stats chips, or a mascot column.

The only inner-structure add is **one glyph row** inside the card you already have (CURRENT QUEST). Everything else is paint: a light-blue wash on that card, and a blue fill on the progress bar that already exists.

| Block | Stays where it is | What changes |
| --- | --- | --- |
| Sidebar (Home, Quests, Letters, Phrases, Profile, dark mode) | Yes | Nothing in slice 1 |
| Course switcher (Greek Foundations) | Yes | Nothing |
| Intro (eyebrow, heading, minutes line) | Yes | Nothing |
| Current-quest card | Yes | Wash + optional letter glyph **inside** the card |
| Quest progress card | Yes | Bar fill color only |
| Explore Greek list | Yes | Nothing |
| Profile summary card | Yes | Nothing |

```text
TODAY (unchanged skeleton)

  ┌─────────┐     ┌──────────────────────────────────────────────┐
  │ logo    │     │                              [🇬🇷 Greek ▾]  │
  │ Home    │     │  HOME · GREEK · A0-A1                        │
  │ Quests  │     │  Continue your Greek quest.                  │
  │ Letters │     │  8 focused minutes. One clear next step.     │
  │ Phrases │     │                                              │
  │ Profile │     │  [ 1  CURRENT QUEST CARD      ]  ← paint     │
  │         │     │  [ 2  QUEST PROGRESS          ]  ← bar color │
  │ Dark    │     │  [ 3  EXPLORE GREEK           ]  ← untouched │
  └─────────┘     │  [ 4  YOUR PROFILE            ]  ← untouched │
                  └──────────────────────────────────────────────┘
```

Not this (Duolingo-shaped; we are not doing it):

```text
  ┌────┐   ┌──────── path of circles ────────┐   ┌ streak / gems ┐
  │nav │   │ unit banner + START + owl       │   │ Super / XP    │
  └────┘   └─────────────────────────────────┘   └───────────────┘
```

## Home — full page, after

Zinc = unchanged. `~` = light-blue wash. `=` = blue progress fill. `α` = the one new element.

```text
┌──────────────┬─────────────────────────────────────────────────────────┐
│ GlideLingo   │                                            [🇬🇷 Greek ▾] │
│              │                                                         │
│  Home        │  HOME · GREEK · A0-A1                                   │
│  Quests      │  Continue your Greek quest.                             │
│  Letters     │  8 focused minutes. One clear next step.                │
│  Phrases     │                                                         │
│  Profile     │  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │
│              │  ~  CURRENT QUEST                              8 MIN  ~  │
│              │  ~                                                    ~  │
│              │  ~                    α                               ~  │
│              │  ~           The sound of Greek                       ~  │
│              │  ~  I can recognize core Greek letters and            ~  │
│              │  ~  sound patterns.                                   ~  │
│              │  ~                                                    ~  │
│              │  ~  [████████ Continue quest ████████]                ~  │
│              │  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │
│              │         wash: white → faint sky. button still black     │
│              │                                                         │
│              │  QUEST PROGRESS                                         │
│              │  Decode Greek letters                                   │
│              │  ┌─────────────────────────────────────────────────┐   │
│              │  │  0 of 3 lessons                            0%   │   │
│              │  │  [====                                        ] │   │
│              │  │  [ See all quests ]                             │   │
│              │  └─────────────────────────────────────────────────┘   │
│              │                                                         │
│              │  EXPLORE GREEK                                          │
│              │  Learn beyond the next lesson                           │
│              │  ┌─────────────────────────────────────────────────┐   │
│              │  │  Aa  Letters          Alphabet, sounds…      ›  │   │
│              │  │  ○   Phrases          Useful words…          ›  │   │
│              │  └─────────────────────────────────────────────────┘   │
│              │                                                         │
│  Dark mode   │  YOUR PROFILE                                           │
│              │  ┌─────────────────────────────────────────────────┐   │
│              │  │  Your first demonstrated ability will appear    │   │
│              │  │  Choose a weekly rhythm…                        │   │
│              │  │  View profile                                   │   │
│              │  └─────────────────────────────────────────────────┘   │
└──────────────┴─────────────────────────────────────────────────────────┘
```

## Inside the current-quest card (the only layout add)

Today the card is three stacked rows. After, it is four. Nothing around it moves.

```text
NOW                                      AFTER
┌─────────────────────────────┐          ┌─────────────────────────────┐
│ CURRENT QUEST        8 MIN  │          │ CURRENT QUEST        8 MIN  │
│                             │          │                             │
│ The sound of Greek          │          │            α                │  ← NEW
│ I can recognize core…       │          │ The sound of Greek          │
│                             │          │ I can recognize core…       │
│ [ Continue quest ]          │          │                             │
└─────────────────────────────┘          │ [ Continue quest ]          │
                                         └─────────────────────────────┘
                                         card fill: white → light blue
```

Glyph rules:

- Show when the next lesson has a single letter/sound to feature (`α`, `ε`, `ι`).
- Hide when the next step is a phrase, a review check, or course-complete. The card then looks like today, just with the wash.
- The letter is content, not a mascot. Same type family, larger size, sitting on `accentSoft`.

## Other screens (no skeleton change)

**Quests.** Same layout. Current-quest band may use flat `accentSoft` (no second gradient). Course map stays zinc.

```text
QUESTS · GREEK FOUNDATIONS
3 quests to your first conversations.

┌ current quest band (flat sky tint, not a wash) ┐
│ CURRENT QUEST · 0 OF 3                         │
│ Decode Greek letters                           │
│ [ Continue · The sound of Greek ]              │
└────────────────────────────────────────────────┘

COURSE MAP
[ existing ModuleTree — unchanged ]
```

**Sitting.** Same beats. Color only on the choice that was checked. Done beat may pick up the Home wash because that is a real pause.

```text
CHECK                                      DONE (later)
What sound is this?                        ┌ closure card, same wash ┐
┌ α ┐                                      │ PRACTICED / DEMONSTRATED│
│ ε │  green border if correct             │ You can recognize…      │
│ ι │  coral + explanation if not          │ [ Next lesson ]         │
[ Continue ]  still black                  └─────────────────────────┘
```

**Profile.** Same sections. Demonstrated card stays green (evidence). Do not paint it blue.

## Chrome we leave alone

Sidebar, course switcher, Explore rows, dark-mode toggle, empty states. Optional later: focused tab uses `accentSoft` instead of zinc selected. That is slice 2, only if Home still feels too gray after slice 1.

## Motion

Existing budget in `theme.ts`: `quick` 140 · `standard` 220 · `deliberate` 360.

| Moment | Motion | Cap |
| --- | --- | --- |
| Land on Home | none, or 220ms fade of the wash | once per visit |
| Continue press | existing opacity press | — |
| Correct check | ≤140ms color settle | every item, tiny |
| Incorrect | none beyond color + copy | — |
| Lesson close | 220–360ms wash in | once per sitting |
| First demonstrated letter | glyph 360ms, small scale 1.0 → 1.04 | once per capability |

No looping shine on the CTA. Reduced-motion: skip scale; keep static color.

## Integrity

- Blue on Home means “this is the next useful action,” not “you have learned this.”
- Green remains the only color that may sit next to demonstrated / correct.
- Weekly rhythm, if shown, stays gold or zinc. Do not paint the week blue or it will look like ability.
- Never communicate state with color alone: keep “8 MIN”, “0 of 3 lessons”, and evidence copy.

## First implementation slice

Do this and stop. Judge the feel before painting more of the app.

1. Add `accent`, `accentStrong`, `accentSoft`, `accentMid` to `src/constants/theme.ts`.
2. Add a `GlideSurface` variant `accent` (soft fill) and a web/native wash only for `hero`.
3. Home current-quest card: wash + optional current-letter glyph from the next lesson.
4. Quest `ProgressBar` on Home uses `accentStrong` instead of `theme.tint`.
5. Kit page: document the new roles (“Accent = next action”).
6. Amend `DESIGN_SYSTEM.md` principle 3 and the gradient usage rule to match this file.

Out of this slice: sidebar recolor, button recolor, mascot, new animations library, dark-mode experiments beyond the token pair, Quests map restyle.

## Measurement (qualitative for this slice)

- **Hypothesis:** a quiet blue wash on the next-action card increases “I know where to tap” without making the app feel like a different product.
- **Behavior:** time-to-tap Continue, or unprompted “this feels warmer” vs “this looks like Duolingo / like a toy.”
- **Guardrail:** if Explore, Profile, or nav are described as louder than Home, the accent leaked. Pull it back.
- **Remove if:** the wash reads as a banner ad, type contrast fails, or learners think the blue card means the quest is already complete.

## Open decisions

1. **Riskiest assumption:** a wash + light-blue progress fill is enough “fun” without changing the black button. If it still feels dead, the next lever is the glyph, not more gradient.
2. Glyph on the Home card: yes for the first sound mission (`α` / current letter); hide when the next lesson has no single grapheme.
3. Focused sidebar item: stay zinc until slice 1 is seen in the browser.

## What stays deliberately plain

Nav, lists, secondary buttons, course switcher, and any percentage that is only structural completion. Fun lives in the next step and in honest feedback, not in the chrome.
