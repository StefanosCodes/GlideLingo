# GlideLingo V1 Product Experience

> Voice scope note: avatar references in this exploratory experience document are not authority for
> the Core V1 Voice implementation. `PRODUCT.md` and `docs/voice/VOICE-REALTIME.md` define the
> approved browser-only direct OpenAI Realtime slice; avatar, video, HeyGen, and LiveAvatar are out
> of scope.

## Status

This document is the product experience source of truth for the V1 consumer application.

It defines:

- the product promise;
- the learning objective;
- the desktop sidebar and mobile navigation;
- every V1 primary tab;
- what happens after each important click;
- the speaking experience;
- AI tutor and avatar roles;
- progress, stars, XP, streaks, and celebrations;
- how current repository surfaces map into the new product;
- what is explicitly not V1.

This document should be read together with `DESIGN_SYSTEM.md` and `docs/learning/LEARNING-STANDARD.md`.

Where this document conflicts with old navigation or old prototype naming, **this document wins for product UX**.

Where this document introduces game mechanics that `LEARNING-STANDARD.md` currently marks as deferred, implementation must update that standard at the same time. V1 may use XP, stars, streaks, and achievements only under the truthful-progress rules in this document.

---

# 1. Product in one sentence

> **GlideLingo is a structured language course built around actually speaking the language.**

The user should understand GlideLingo without hearing about AI architecture, retrieval practice, curriculum graphs, learner graphs, SRS, CEFR, or pedagogy.

The simple promise is:

> **Learn it. Speak it. Use it. Get better.**

The deeper system underneath is:

```text
Teach -> Retrieve -> Produce -> Perform -> Evaluate -> Adapt -> Revisit
```

The learner should never have to design their own curriculum.

GlideLingo gives them the path.

The learner can still choose how they want to practice around that path.

---

# 2. What makes GlideLingo different

GlideLingo is not:

- an empty AI chat box;
- a generic AI language tutor;
- a flashcard app;
- a course consisting mostly of multiple choice;
- a voice-chat app with no learning structure;
- a collection of unrelated language tools;
- a Duolingo clone with prettier colors.

The differentiator is the combination of **structure + speaking + adaptive evidence + learner freedom**.

## The four pillars

### 1. A real authored course

The learner always has a clear path.

They know:

- where they are;
- what they are learning;
- what they can do after the unit;
- what comes next.

AI does not invent the curriculum live.

### 2. Speaking is part of learning, not a side feature

The learner should produce language early and repeatedly.

A lesson should not feel complete because the learner tapped the right translation.

Whenever appropriate, the learner moves from:

```text
See it -> Understand it -> Recall it -> Say it -> Use it
```

### 3. Progress is based on evidence

GlideLingo distinguishes:

```text
Completed
Practiced
Demonstrated
Retained
```

A user may earn XP for activity, but XP does not mean fluency.

A three-star unit means something different from simply finishing it.

### 4. Structure without confinement

The default path is extremely clear:

> **Continue your course.**

But the learner can always choose:

- Speak;
- Practice;
- Review;
- repeat a lesson;
- work on a weak area.

Internal principle:

> **GlideLingo owns the path. The learner owns the pace and practice style.**

---

# 3. V1 learning objective

The objective is not "complete lessons."

The objective is:

> **Build durable, usable language capability and make the learner comfortable producing the language in real situations.**

The existing learning cycle remains correct:

```text
Encounter -> Notice -> Retrieve -> Produce -> Perform -> Revisit
```

For V1, this becomes a simpler learner-facing loop:

```text
LEARN -> SPEAK -> WIN -> PROGRESS -> COME BACK
```

## Learn

Understand useful language in context.

## Speak

Produce it with progressively less help.

## Win

Receive immediate, friendly proof that the effort counted.

## Progress

See course progress and demonstrated capability improve.

## Come back

GlideLingo gives the next useful lesson, conversation, or review.

---

# 4. Experience personality

GlideLingo should feel:

- premium;
- calm;
- intelligent;
- friendly;
- warm;
- encouraging;
- modern;
- easy to understand;
- slightly playful when the learner succeeds.

It should not feel:

- academic and sterile;
- childish;
- hyperactive;
- shame-driven;
- cluttered;
- like a productivity dashboard;
- like a complicated AI tool.

The product can use confetti, green success states, stars, XP, streaks, sound, and animation.

The rule is:

> **The interface stays calm. Success moments can become energetic.**

---

# 5. Primary information architecture

## Desktop sidebar

```text
┌────────────────────────────┐
│  GlideLingo                │
│                            │
│  🇬🇷 Greek                 │
│  A1 · Beginner        ▾    │
│                            │
│  Home                      │
│  Course                    │
│  Speak                     │
│  Practice                  │
│  Progress                  │
│                            │
│                            │
│  ───────────────────────   │
│  🔥 12 days                │
│  ⭐ 1,420 XP               │
│                            │
│  Invite friends            │
│  Profile / Settings        │
└────────────────────────────┘
```

## Primary tabs

```text
Home
Course
Speak
Practice
Progress
```

These are product concepts, not implementation categories.

Each answers one clear question.

### Home

> **What should I do right now?**

### Course

> **What is my complete path?**

### Speak

> **Can I use the language right now?**

### Practice

> **What do I want to strengthen?**

### Progress

> **Am I actually getting better?**

If a V1 feature does not naturally fit one of these destinations, question whether it belongs in V1.

---

# 6. Sidebar behavior

## 6.1 Brand

Top-left:

```text
[bird] GlideLingo
```

Clicking the brand returns to Home.

The sidebar remains collapsible on desktop.

Collapsed state:

```text
[bird]
[home]
[course]
[mic]
[practice]
[progress]
...
[profile]
```

Tooltips expose labels when collapsed.

## 6.2 Language selector

Directly under the logo:

```text
🇬🇷 Greek
A1 · Beginner
```

Clicking opens a small language/course switcher.

V1 behavior:

- available language can be selected;
- unavailable language may appear only if the existing product intentionally exposes coming-soon courses;
- current progress remains associated with the course;
- switching a language does not reset progress.

Do not bury language selection under Settings.

## 6.3 Navigation

Order is fixed for V1:

```text
Home
Course
Speak
Practice
Progress
```

**Speak stays above Practice** because speaking is part of the product positioning.

## 6.4 Persistent motivation strip

Near the bottom, show only two lightweight metrics:

```text
🔥 12 days
⭐ 1,420 XP
```

Clicking streak opens the rhythm/consistency detail.

Clicking XP opens Progress, scrolled or focused to activity/game metrics.

Do not show six stats in the sidebar.

## 6.5 Invite

`Invite friends` is secondary.

It may open a simple modal/page with:

- referral link;
- copy link;
- native share action;
- optional referral reward copy if/when implemented.

It does not belong in the main learning flow.

## 6.6 Profile / Settings

Profile/account is not a primary learning destination.

It contains:

- user identity;
- account;
- membership / subscription;
- theme;
- audio preferences;
- speech preferences;
- learning goal / weekly rhythm;
- notifications when implemented;
- data/account controls.

Learning metrics move to **Progress**.

---

# 7. Mobile navigation

Mobile should preserve the same mental model.

Preferred V1 bottom tabs:

```text
Home | Course | Speak | Practice | Progress
```

`Speak` may receive a slightly stronger icon treatment, but it should not become a giant floating gimmick unless testing proves it improves use.

Profile is reached from the Home header or Progress header.

The same product concepts should exist on desktop and mobile even if visual navigation differs.

---

# 8. Home

Home is the most important screen in the product.

Its purpose is not to summarize everything.

Its purpose is:

> **Orient the learner and get them into meaningful practice quickly.**

## Home hierarchy

```text
1. Greeting / current course
2. One dominant Continue action
3. Today's learning plan
4. Quick Speak / Practice actions
5. Small progress/motivation snapshot
6. Review cue if useful
7. Recent meaningful achievement if one exists
```

No section should compete visually with `Continue`.

---

## 8.1 Home header

Example:

```text
Good afternoon, Stefanos.

Greek · A1 Beginner
```

Keep this simple.

Do not put a large marketing headline here once the learner is enrolled.

---

## 8.2 Primary Continue card

This is the dominant object.

Example:

```text
CONTINUE LEARNING

Ordering at a Café
Unit 4 · Lesson 2

Learn how to order naturally and ask what something costs.

12 min

[ Continue ]
```

The system chooses the card using deterministic next-action logic.

Priority:

```text
1. Critical due review if learning policy requires it
2. Resume interrupted lesson
3. Next course lesson
4. Course checkpoint
5. Course-complete next step
```

A review should not unexpectedly replace all new learning every time one item is due.

The learner should understand **why** a review is recommended.

Example:

> "A few phrases from yesterday are ready to strengthen."

Not:

> "You forgot these."

---

## 8.3 Today's plan

Show a tiny plan underneath the hero.

Example:

```text
TODAY

✓ Learn       8 min
○ Speak       4 min
○ Review      3 min

1 of 3 complete
```

This should be generated from the learner's current path and state.

It is not a hard obligation.

Missing the plan never removes capability evidence or completed work.

V1 does not need complex daily-plan customization.

---

## 8.4 Quick actions

Always provide:

```text
[ Speak now ]   [ Practice ]
```

### Speak now

Starts or opens the Speak destination with a recommended conversation based on current course knowledge.

### Practice

Opens Practice with `Recommended for you` first.

This is how GlideLingo provides learner autonomy without abandoning structure.

---

## 8.5 Home metrics

Keep them compact.

Example:

```text
🔥 12 days     🎙 43 min this week
⭐ 1,420 XP    🇬🇷 38% course
```

Do not imply that course percentage equals fluency.

Possible V1 metrics:

- current rhythm/streak;
- XP;
- speaking minutes;
- course completion.

More detailed metrics live in Progress.

---

## 8.6 Review cue

If meaningful review exists:

```text
READY TO REVIEW
6 phrases are ready to strengthen.
[ Quick review ]
```

Do not show a scary backlog count.

If 73 items are technically due, the UI may offer a useful 5-10 item session rather than presenting `73 overdue`.

---

## 8.7 Recent achievement

Only show if something worth showing happened.

Example:

```text
RECENT ACHIEVEMENT

First Conversation
You held a 2-minute Greek conversation.
```

Do not permanently fill Home with badge furniture.

---

# 9. Course

Current `Quests` becomes **Course**.

The current repo already has the right fundamental structure:

```text
course -> modules/quests -> lessons -> capabilities
```

The V1 UX should stop making `Quest` the top-level navigation concept.

`Quest` can remain an internal/content term or become a user-facing unit label only if it improves the course feel.

Preferred user vocabulary:

```text
Course
Unit
Lesson
Conversation / Challenge
Checkpoint
```

This is clearer to mainstream learners.

---

## 9.1 Course page purpose

Course answers:

> **Where am I going and what will I be able to do?**

Example:

```text
Greek Foundations
A1 Beginner

38% complete

01  Meet someone              ⭐⭐⭐
02  Introduce yourself        ⭐⭐⭐
03  Numbers & age             ⭐⭐☆
04  Order a coffee            ⭐☆☆   <- current
05  Talk about family         ○○○
06  Ask directions            🔒
07  Shopping                  🔒
```

The course should look premium and structured, not like a giant game board.

---

## 9.2 Unit card

Clicking a unit opens:

```text
ORDERING AT A CAFÉ

By the end, you can:
Order a drink, ask the price, and respond to a basic follow-up question.

Progress: 2 of 5 lessons
Stars: ⭐☆ ☆

Lessons
✓ Useful café phrases
✓ Asking for something
→ Say it naturally
○ Listening in context
○ Café conversation

[ Continue ]
```

This is where the learner sees the **real-world learning objective**.

Never title a unit only around grammar when a useful capability can lead.

Bad:

> Accusative Articles 1

Better:

> Order at a Café

Grammar is taught inside the capability.

---

## 9.3 Lesson structure

A V1 lesson may use several activity types, but the learner experience should generally move through:

```text
1. Encounter
2. Understand
3. Retrieve
4. Say / Produce
5. Apply
```

Not every lesson needs all five stages.

The complete unit should.

### Encounter

Show language in context.

Example:

```text
Θα ήθελα έναν καφέ.
I'd like a coffee.
[play audio]
```

### Understand

Ask the learner to show they understand the meaning.

Recognition is allowed here.

### Retrieve

Remove the answer and make them recall it.

### Say / Produce

The learner speaks or constructs language.

### Apply

Use it in a changed situation.

The final conversation/checkpoint should not simply repeat the exact practice prompt.

---

## 9.4 Lesson completion

Lesson completion should feel satisfying.

Example:

```text
NICE WORK

Lesson complete ✓

+90 XP
3 phrases practiced
1:42 spoken

You can now ask for a drink politely.

[ Continue ]
[ Done for now ]
```

### Visual behavior

- green success state;
- short success sound if enabled;
- subtle confetti for lesson completion;
- progress bar advances;
- XP animates upward;
- real capability statement remains the headline.

Do not fire full-screen confetti after every correct answer.

---

# 10. Stars

Stars represent **unit mastery depth**, not currency.

Each unit supports three stars.

## Star 1 — Learned

```text
⭐☆☆
```

Earned when required lesson material is completed and qualifying practice has occurred.

Meaning:

> "I completed the learning experience."

## Star 2 — Demonstrated

```text
⭐⭐☆
```

Earned when the learner successfully demonstrates the unit capability with reduced support in a fresh or meaningfully varied checkpoint.

Meaning:

> "I could do it without simply copying the lesson."

## Star 3 — Retained

```text
⭐⭐⭐
```

Earned after delayed retrieval or transfer demonstrates the capability again.

Meaning:

> "I could still do it later or in a changed context."

This directly maps game feedback onto the existing evidence model:

```text
Introduced -> Practiced -> Demonstrated -> Retained
```

Stars must not be purchasable.

Stars must not be earned by grinding XP.

---

# 11. Speak

Speak is a first-class product destination.

It is not merely an AI chat tab.

Speak answers:

> **Let me use the language right now.**

There are two V1 modes:

```text
1. Guided Conversations
2. Just Talk
```

---

# 12. Guided Conversations

Guided conversations are connected to the course.

Example Speak home:

```text
SPEAK

Recommended for you

☕ Order Coffee
Practice Unit 4
4-6 min
[ Start ]

👋 Introductions
Review Unit 2
3-5 min

🏨 Check into a Hotel
Locked · complete Unit 7

----------------

Just Talk
Have an open conversation at your level.
[ Start talking ]
```

The learner should immediately understand why a conversation is recommended.

---

## 12.1 Conversation setup

Before starting, show a lightweight briefing.

Example:

```text
CAFÉ CONVERSATION

Goal
Order a coffee and answer one follow-up question.

You'll practice
• Θα ήθελα...
• numbers
• polite requests

Andreas
Café owner · Athens

[ Start conversation ]
```

No giant instructions page.

---

## 12.2 Conversation experience

The conversation should feel like speaking with a person, not filling a form.

Base V1 layout:

```text
[ Character / avatar area ]

Andreas
Καλημέρα! Τι θα θέλατε;

[ waveform / live listening state ]

          [ Hold / tap to speak ]

[ Need a hint? ]
```

### Required interaction states

```text
Ready
Listening
Thinking
Speaking
Needs clarification
Connection issue
Paused
Complete
```

The learner always knows whether the app is listening.

---

## 12.3 Conversation language policy

Guided conversation should know:

- current language;
- current course;
- completed lessons;
- target unit;
- vocabulary/patterns introduced;
- learner evidence;
- allowed stretch vocabulary;
- support level.

The AI should not casually jump far beyond the learner's level.

For a beginner:

- shorter sentences;
- slower delivery;
- familiar vocabulary;
- generous repair;
- meaningful repetition;
- contextual hints.

As the learner improves:

- normal speed;
- more ambiguity;
- fillers;
- natural follow-up questions;
- varied wording;
- less support.

---

## 12.4 Corrections during conversation

Do not interrupt every error.

Priority:

```text
1. Keep communication alive
2. Repair when meaning breaks
3. Correct high-value target errors
4. Save lower-value corrections for the recap
```

Example:

Learner says a slightly unnatural phrase but meaning is clear.

AI responds naturally and continues.

At recap:

```text
More natural:
Θα ήθελα έναν καφέ.
```

If meaning fails, the AI can say:

> "Almost — try asking for the coffee again."

The conversation should never shame the learner.

---

# 13. Just Talk

Some users will open GlideLingo because they simply want to speak.

Do not force them through Course first every time.

Just Talk offers:

```text
Easy
Stay mostly inside what I know.

Stretch Me
Use what I know and introduce a little more.

Open
Talk naturally around my estimated level.
```

V1 can default to `Easy` and optionally expose the other modes.

The system may offer topics:

- your day;
- food;
- family;
- travel;
- plans;
- hobbies;
- something from the learner's completed course material.

The learner can also choose `Surprise me`.

---

# 14. AI characters and avatar strategy

The AI character system is important, but **photorealistic avatars are not required to prove V1**.

The product architecture must support characters from day one.

Each conversation participant should have:

```text
id
name
role
location/context
personality
speech style
voice
supported difficulty range
scenario rules
visual representation
```

Example Greek characters:

### Eleni

```text
Role: Tutor / coach
Style: warm, clear, patient
Use: explanation, recovery, pronunciation help
```

### Andreas

```text
Role: café owner
Style: friendly, practical
Use: ordering scenarios
```

### Maria

```text
Role: peer / friend
Style: conversational
Use: introductions, plans, everyday talk
```

### Giorgos

```text
Role: older speaker
Style: slightly more natural/varied
Use: later listening and interaction practice
```

---

## 14.1 Character progression

V1 visual representation may be:

```text
illustrated portrait + voice + subtle animation
```

Later:

```text
real-time animated avatar
```

Later still:

```text
high-realism AI human / scene
```

The educational system must not depend on visual realism.

The avatar is the **interface to a real learning scenario**, not the moat by itself.

---

## 14.2 When to introduce avatars

Do not introduce a realistic avatar during the first thirty seconds of onboarding just to show technology.

The first meaningful introduction should be attached to a purpose.

Example:

After the learner has learned first greetings:

```text
READY TO USE IT?

Meet Maria.
She'll ask your name in Greek.

[ Start your first conversation ]
```

This gives the avatar emotional meaning.

---

# 15. Conversation completion

Conversation completion is one of the strongest emotional moments in the product.

Example:

```text
YOU DID IT

Conversation complete ✓

You ordered a coffee in Greek.

⭐⭐☆

+180 XP
3:42 spoken
6 turns completed

What went well
✓ You made the request clearly
✓ You understood the price question

One thing to improve
"έναν καφέ" needs another pass

[ Practice that ]
[ Continue course ]
```

### Celebration intensity

First-ever conversation:

- stronger confetti;
- stronger success sound;
- shareable milestone;
- achievement unlocked.

Routine conversation:

- short green success;
- XP animation;
- concise recap.

Do not turn every conversation into a five-screen reward flow.

---

# 16. Conversation evidence

Every conversation should feed the learner model.

Capture at minimum:

- conversation/scenario ID;
- target capabilities;
- turns attempted;
- hints used;
- target-language production;
- task completion;
- repair needed;
- relevant errors;
- speaking time;
- support level;
- whether prompt/context was fresh enough to count as evidence.

V1 should be conservative with pronunciation scoring.

Do not show fake precision such as:

```text
Pronunciation 87.4%
```

unless the evaluator is actually validated enough to justify it.

Prefer:

```text
Clear
Needs another pass
Try this sound again
```

or no pronunciation score at all.

---

# 17. Practice

Practice is where learner autonomy lives.

Practice answers:

> **I know the course path, but what do I want to work on right now?**

V1 Practice home:

```text
PRACTICE

Recommended for you
6 phrases ready to strengthen
[ Quick review ]

Your tools
Vocabulary
Listening
Pronunciation
Speaking drills
Mistakes
Letters & sounds

Optional later
Stories
Grammar focus
Shadowing
```

V1 should not expose every experimental learning method as a separate product.

Keep the choices understandable.

---

# 18. Practice: Recommended

Recommended appears first.

It uses deterministic signals such as:

- due review;
- recent errors;
- weak course capability;
- neglected mode;
- interrupted learning;
- upcoming course requirement.

Example:

```text
RECOMMENDED

Strengthen café phrases
6 items · ~3 min

You used these yesterday. A quick recall now helps them stick.

[ Start ]
```

The recommendation should always have a human-readable reason.

---

# 19. Practice modes

## 19.1 Vocabulary / Phrases

Current `Phrases` content moves here.

User can:

- review learned phrases;
- hear audio;
- hide/show meaning;
- retrieve from English -> target;
- retrieve target -> meaning;
- speak the phrase when speech is appropriate.

Do not turn this into an endless dictionary.

Prioritize course-connected language.

## 19.2 Listening

Activities may include:

- hear and choose meaning;
- hear and type/construct;
- listen then answer a question;
- listen to a short course-connected dialogue;
- replay at normal/slow speed when appropriate.

## 19.3 Pronunciation

User can:

- hear a model;
- record/repeat;
- compare;
- retry.

Feedback should be humble and useful.

## 19.4 Speaking drills

Fast retrieval practice without a full conversation.

Example:

```text
Say: "I'd like water."
🎙
```

Then:

```text
Good ✓
Now: "I'd like a coffee."
```

Useful for pattern fluency.

## 19.5 Mistakes

Shows high-value recent errors worth revisiting.

Do not create a guilt-inducing graveyard of every mistake ever made.

Prefer:

```text
Worth another pass
```

instead of:

```text
Wrong answers
```

## 19.6 Letters & Sounds

Current `Letters` moves here.

This is especially important for Greek and other scripts.

It remains available as a structured reference/practice area but no longer consumes a primary sidebar slot.

---

# 20. Review

Review is a behavior across Home and Practice, not a primary tab.

Review follows learner evidence and time.

The learner should understand why something returned.

Example:

> "You learned this three days ago. Let's make sure it still comes easily."

Not:

> "Overdue."

Review should vary the context when possible.

A phrase learned as:

> "I'd like a coffee."

may later appear through:

- spoken recall;
- different noun;
- café conversation;
- listening comprehension;
- polite request in another scenario.

That is stronger than repeating the identical card.

---

# 21. Progress

Progress answers:

> **Show me that I am becoming capable.**

This page should be motivating enough that users want to open it.

It contains three layers:

```text
1. Real learning progress
2. Activity / consistency
3. Game progress
```

Never collapse them into one fake score.

---

## 21.1 Progress hero

Example:

```text
YOUR GREEK

A1 Beginner
38% through Greek Foundations

Next milestone
Hold a basic café conversation with reduced support.
```

Do not say `38% fluent`.

---

## 21.2 Skill profile

Reuse the existing evidence-mode concept.

V1 can show:

```text
Speaking      Practiced
Listening     Demonstrated
Reading       Introduced
Writing       Not yet
```

Later this can become richer.

Do not manufacture numeric percentages when evidence does not support them.

---

## 21.3 What you can do

This should be one of the best parts of Progress.

Example:

```text
WHAT YOU CAN DO

✓ Introduce yourself
✓ Ask someone's name
✓ Order a basic drink
◐ Understand a simple price question
○ Ask for directions
```

Use the existing capability evidence model.

The learner should be able to feel:

> "I could actually do these things in Greece."

---

## 21.4 Speaking metrics

Because speaking is central to positioning, show:

```text
This week
43 min spoken
7 conversations
128 spoken turns
```

Over time:

```text
Total speaking time
Longest conversation
Conversations completed
Guided scenarios completed
```

Only count meaningful microphone production, not silence while a conversation screen is open.

---

## 21.5 Course metrics

Show:

- course completion;
- current unit;
- units completed;
- stars earned;
- retained units/capabilities when available.

---

## 21.6 Consistency

Show:

- current streak/rhythm;
- practice days this week;
- chosen weekly goal;
- calendar.

A missed day does not erase anything.

If strict consecutive-day streaks are used, copy must avoid shame.

Recommended terminology can remain `streak` for consumer clarity, but product behavior should stay humane.

---

## 21.7 Game metrics

Show:

```text
XP
Stars
Achievements
```

Keep this visibly separate from capability claims.

---

# 22. XP

XP is an engagement/activity score.

It answers:

> **How much meaningful learning activity did I do?**

It does not answer:

> "How fluent am I?"

V1 sample XP rules:

```text
Complete lesson               +60 to +100
Complete meaningful review    +20 to +50
Complete guided conversation  +100 to +200
Complete checkpoint           +100
Earn demonstration star       +bonus
Earn retention star           +bonus
```

Do not award XP for meaningless tapping, opening screens, or replaying something with no effort.

No virtual currency/shop in V1.

---

# 23. Achievements

Achievements should recognize identity and meaningful milestones.

V1 examples:

### First Words

Produce your first 25 target-language responses.

### First Conversation

Complete your first guided conversation.

### No English Needed

Complete an eligible guided conversation without requesting an English rescue.

### Chatterbox

Accumulate 60 minutes of meaningful speaking.

### Athens Ready

Demonstrate the published travel-foundation capabilities.

### A1 Foundations

Complete the published A1 foundations path.

Avoid badges such as:

> "Opened the app 10 times."

unless there is a very clear product reason.

---

# 24. Celebration system

The success system is part of V1.

It should be intentionally tiered.

## Tier 1 — micro success

Examples:

- correct response;
- successful pronunciation attempt;
- recovered mistake.

Feedback:

- green check;
- small haptic/sound if enabled;
- <1 second;
- immediately continue.

## Tier 2 — lesson success

Feedback:

- green completion surface;
- small confetti burst;
- XP increase;
- capability copy;
- next action.

## Tier 3 — meaningful milestone

Examples:

- first conversation;
- first three-star unit;
- retained real-world capability;
- course stage completion.

Feedback:

- stronger confetti;
- distinct animation;
- achievement;
- optional share action.

## Tier 4 — major milestone

Examples:

- A1 course completion;
- 10 hours spoken;
- major proficiency checkpoint.

Feedback can be memorable and shareable.

Rule:

> **If everything gets confetti, confetti becomes meaningless.**

---

# 25. Friendly failure and mistakes

Incorrect answers should never feel punitive.

Do:

```text
Almost.
The article changes here: έναν καφέ.
Try it once more.
```

Do not:

```text
WRONG
You lost a heart.
```

Mistakes:

- do not consume lives;
- do not block continued learning;
- can lower evidence quality;
- can create a future practice recommendation;
- can trigger support or explanation.

The learner should feel safe enough to speak badly before they speak well.

---

# 26. AI tutor

The AI tutor is a support layer across the product.

It should not become another main navigation tab.

Existing lesson-tutor infrastructure should remain connected to lesson context.

Tutor roles:

```text
Explain
Give another example
Help me remember
Why was that wrong?
How do I say this?
Practice this with me
```

Within a lesson, a small `Ask` action can open the tutor drawer.

The tutor knows:

- current language;
- course;
- lesson;
- target capability;
- visible activity;
- relevant learner context.

The tutor should answer within the course contract rather than dragging the learner into unrelated content.

---

# 27. AI relationship model

There are three distinct AI roles.

## Tutor

Explains learning.

```text
"Why does this word change?"
```

## Coach

Helps the learner improve performance.

```text
"Try that sentence again a little more slowly."
```

## Character

Acts like the person in the real situation.

```text
"Καλημέρα! Τι θα θέλατε;"
```

Do not blur them constantly.

A café owner should not suddenly lecture grammar for 90 seconds unless the user explicitly asks for help.

---

# 28. First-time experience

The first session should prove the product promise quickly.

Goal:

> **Within the first session, the learner should say useful target-language speech and experience a tiny conversation.**

Suggested flow:

```text
1. Choose language
2. Choose reason
3. Choose approximate experience/level
4. Choose realistic learning rhythm
5. Enter first course lesson
6. Learn a tiny useful pattern
7. Speak it
8. Complete first mini interaction
9. Celebrate
10. Show the path forward
```

Do not spend five minutes configuring methodology preferences.

V1 can learn preferences through behavior later.

---

# 29. Onboarding questions

Keep onboarding minimal.

## Language

> What do you want to learn?

## Why

Options:

```text
Conversation
Travel
Family / heritage
Work
School
Fluency
Just for fun
```

This can influence examples/scenario priorities later.

## Current level

```text
Starting fresh
I know a little
I can handle basics
Not sure
```

V1 may start everyone in one available beginner course if placement is not built yet.

Do not pretend placement exists when it does not.

## Rhythm

```text
10 min/day
20 min/day
30 min/day
Flexible
```

or weekly rhythm if that better matches current product policy.

---

# 30. First conversation introduction

After enough material exists to avoid a meaningless exchange:

```text
READY TO USE IT?

You've learned enough for your first Greek conversation.

Maria will greet you and ask your name.
You can ask for help at any time.

[ Start ]
```

This is a product milestone.

The learner should feel slight nervousness followed by success.

That emotional transition is valuable.

---

# 31. Course checkpoints

A unit checkpoint tests integrated use with less support.

It should use:

- unseen or varied prompts;
- speaking when the unit targets speaking;
- listening when relevant;
- practical task completion.

Example café checkpoint:

```text
Scenario:
You walk into a café.

Goal:
Order a drink and respond to the price.
```

The learner is not shown the exact target sentence before speaking.

Successful checkpoint can award star 2.

Delayed transfer can award star 3.

---

# 32. Share experience

Sharing should let learners celebrate themselves, not advertise the product awkwardly.

Possible share card:

```text
MY GREEK THIS WEEK 🇬🇷

43 min spoken
7 conversations
84 phrases practiced
12-day streak

GlideLingo
```

Shareable milestones:

- first conversation;
- three-star unit;
- weekly recap;
- major course milestone.

Sharing is optional.

No public social feed in V1.

---

# 33. Invite friends

V1 may include a basic invite flow.

Do not build a social graph yet.

Possible behavior:

```text
Invite a friend
[ Copy link ] [ Share ]
```

If referral rewards exist:

```text
Invite a friend -> both receive X trial benefit
```

Only implement when billing/referral tracking exists.

Friend streaks, competitions, and leagues are post-V1 unless intentionally reprioritized.

---

# 34. V1 route map from current repository

Current implementation:

```text
/                 Home
/quests           Quests
/letters          Letters
/phrases          Phrases
/profile          Profile
/progress         redirects -> Profile
/review           redirects -> Phrases
/path             redirects -> Quests
```

Target product model:

```text
/                 Home
/course           Course
/speak            Speak
/practice         Practice
/progress         Progress
/profile          Profile / Settings
```

Suggested compatibility:

```text
/quests    -> /course
/path      -> /course
/letters   -> /practice?mode=letters
/phrases   -> /practice?mode=phrases
/review    -> /practice?mode=review
```

Do not delete old route compatibility until navigation migration is stable.

---

# 35. Current component mapping

## `src/components/app-tabs.web.tsx`

Current:

```text
Home
Quests
Letters
Phrases
Profile
```

Target:

```text
Home
Course
Speak
Practice
Progress
```

Footer gains:

```text
streak
XP
Invite friends
Profile / Settings
theme (may remain in profile or footer)
```

Do not overload the footer.

## `src/components/app-tabs.tsx`

Native tabs should mirror:

```text
Home
Course
Speak
Practice
Progress
```

## `src/app/(app)/index.tsx`

Keep and reuse:

- enrolled course;
- current module;
- next lesson;
- active lesson;
- due review;
- course progress;
- weekly rhythm;
- strongest evidence.

Recompose Home around:

```text
Continue
Today's plan
Speak now
Practice
compact metrics
review
recent achievement
```

Remove the current `Explore Greek -> Letters/Phrases` section once those are represented by Practice.

## `src/app/(app)/quests.tsx`

Refactor/rename into Course.

Reuse `ModuleTree` or evolve it into a calmer course/unit list.

Keep real-world can-do outcomes.

## `src/app/(app)/letters.tsx`

Move experience under Practice -> Letters & Sounds.

## `src/app/(app)/phrases.tsx`

Move under Practice -> Vocabulary / Phrases.

## `src/app/(app)/profile.tsx`

Split responsibilities.

Move to Progress:

- capability portfolio;
- skill profile;
- course completion;
- rhythm stats;
- learning metrics.

Keep in Profile/Settings:

- membership;
- account summary;
- settings;
- migration/account controls;
- theme/preferences.

## `src/app/(app)/progress.tsx`

Replace redirect with real Progress screen.

## `src/app/(app)/review.tsx`

Redirect into Practice review mode.

## `src/features/learning-session/*`

Preserve the existing lesson architecture and evolve it around the V1 learning cycle.

## `src/features/learning-session/lesson-tutor/*`

Keep as contextual tutoring infrastructure.

Do not promote it into a generic chat destination.

## `src/features/learning-progress/*`

This is foundational for Progress, stars, review logic, and truthful achievement claims.

## `src/providers/learning-provider.tsx`

This remains a primary source for V1 learner state until backend persistence replaces/extends local state.

It will eventually need additional state for:

- XP;
- speaking minutes;
- conversation attempts;
- achievements;
- star state derived from evidence;
- conversation recommendations.

Avoid storing star truth separately when it can be deterministically derived from capability evidence.

---

# 36. V1 state model additions

The product likely needs typed models for the following.

## Activity / engagement

```ts
xpTotal
xpEvents
practiceDates
speakingSeconds
conversationCount
```

## Conversations

```ts
conversationAttempts
conversationScenarioId
conversationStartedAt
conversationCompletedAt
speakingSeconds
targetCapabilityIds
supportUsed
completionResult
```

## Achievements

Prefer deterministic achievement rules over arbitrary mutable flags.

```ts
achievementId
earnedAt
evidenceRefs
```

## Stars

Prefer derivation:

```text
star 1 <- qualifying learning completion/practice
star 2 <- demonstrated capability
star 3 <- retained capability
```

---

# 37. V1 feature list

These are the intended V1 product experiences.

## Navigation

- Home;
- Course;
- Speak;
- Practice;
- Progress;
- Profile/Settings;
- language/course switcher;
- collapsible desktop rail;
- equivalent mobile navigation.

## Course

- authored beginner course;
- units/modules;
- lessons;
- unit can-do goals;
- lesson completion;
- checkpoints;
- progress;
- stars;
- audio;
- speaking activities;
- contextual AI tutor.

## Speak

- recommended guided scenarios;
- course-connected conversation;
- voice input/output;
- level-bounded AI;
- hints/support;
- conversation recap;
- speaking time;
- evidence capture;
- at least lightweight AI characters.

## Practice

- recommended review;
- vocabulary/phrases;
- listening;
- pronunciation;
- speaking drills;
- mistakes;
- letters/sounds.

## Progress

- course completion;
- capability portfolio;
- communication mode profile;
- speaking minutes;
- conversations;
- rhythm/streak;
- XP;
- stars;
- achievements.

## Motivation

- green success;
- checkmarks;
- XP animation;
- stars;
- streak/rhythm;
- tiered confetti;
- milestone achievements;
- optional share cards.

---

# 38. Explicitly out of scope for V1

Do not let the vision explode.

Not required for V1:

- photorealistic real-time avatars;
- 3D worlds;
- social feed;
- public leaderboards;
- leagues;
- friend competitions;
- tutor marketplace;
- teacher dashboard;
- school licensing product;
- K-12 classroom controls;
- methodology marketplace;
- user-created public courses;
- every language;
- infinite AI-generated lessons;
- open-ended content ingestion;
- virtual currency/shop;
- hearts/lives;
- streak repair purchases;
- massive badge catalog;
- complex placement testing;
- fake pronunciation precision;
- numeric fluency score without validation.

The V1 should prove one thing:

> **A user can follow a beautiful structured course, speak constantly, practice freely, see meaningful progress, and want to come back.**

---

# 39. V1 build order

## Phase 1 — Information architecture

1. Update desktop sidebar.
2. Update native navigation.
3. Rename Quests -> Course.
4. Add Practice shell.
5. Add real Progress destination.
6. Split Profile from learning progress.
7. Add route compatibility redirects.

No new major backend required to prove this slice.

## Phase 2 — Home recomposition

1. Continue hero.
2. Today's plan.
3. Speak quick action.
4. Practice quick action.
5. compact metrics.
6. review cue.

## Phase 3 — Practice consolidation

1. Move Letters into Practice.
2. Move Phrases into Practice.
3. Move Review into Practice.
4. Add recommended practice surface.
5. Preserve existing data and routes.

## Phase 4 — Gamification foundation

1. XP event policy.
2. derived unit stars.
3. streak/rhythm presentation.
4. celebration components.
5. achievements.
6. Progress presentation.

Update `LEARNING-STANDARD.md` before/with this phase because the current document marks XP and generic badges as deferred.

## Phase 5 — Speaking V1

1. scenario contract;
2. character contract;
3. guided conversation screen;
4. voice input/output;
5. course-bounded conversation context;
6. completion criteria;
7. recap;
8. evidence capture;
9. speaking metrics;
10. first-conversation milestone.

## Phase 6 — Polish

1. success motion;
2. confetti tiers;
3. sounds/haptics;
4. share card;
5. accessibility;
6. reduced motion;
7. offline/error states;
8. dark/light parity.

---

# 40. Product acceptance criteria

V1 product direction is successful when a new user can:

1. open GlideLingo and immediately understand what language/course they are in;
2. know the next lesson without searching;
3. understand the real-world goal of that lesson/unit;
4. hear useful language;
5. retrieve useful language;
6. speak useful language;
7. complete a real AI conversation connected to what they learned;
8. receive friendly, useful feedback;
9. see meaningful progress change;
10. earn motivating game feedback without confusing it with fluency;
11. jump into speaking without navigating the course;
12. jump into targeted practice without losing their course position;
13. return later and see the next useful action;
14. understand why a review item has returned;
15. feel proud rather than exhausted by the interface.

---

# 41. Product test: five-second comprehension

A learner looking at GlideLingo should be able to answer these immediately:

```text
What am I learning?
Greek.

What should I do next?
Continue Unit 4.

Can I just practice speaking?
Yes -> Speak.

Can I work on something specific?
Yes -> Practice.

Am I improving?
Yes -> Progress.
```

If the UI cannot answer those questions quickly, simplify it.

---

# 42. Final product principle

Everything in GlideLingo V1 should reinforce this loop:

```text
                    ┌──────────────┐
                    │    COURSE    │
                    │ clear path   │
                    └──────┬───────┘
                           │
                           v
                    ┌──────────────┐
                    │    LEARN     │
                    └──────┬───────┘
                           │
                           v
                    ┌──────────────┐
                    │    SPEAK     │
                    │ use it now   │
                    └──────┬───────┘
                           │
                           v
                    ┌──────────────┐
                    │   FEEDBACK   │
                    │ AI + evidence│
                    └──────┬───────┘
                           │
                           v
                    ┌──────────────┐
                    │   PROGRESS   │
                    │ stars / can-do│
                    └──────┬───────┘
                           │
                   needs strengthening?
                     /             \
                   yes             no
                    |               |
                    v               v
              ┌──────────┐     next course step
              │ PRACTICE │           |
              └────┬─────┘           |
                   └──────────┬───────┘
                              v
                         COME BACK
```

The user's experience is simple:

> **Follow the course. Speak constantly. Practice what you need. Watch yourself improve.**

The technology underneath can become extremely sophisticated.

The interface should not.
