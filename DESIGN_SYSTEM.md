# GlideLingo Design System

GlideLingo follows the exact visual foundation used by the OpenFDE Hackathon frontend, adapted to Expo and React Native. It is compact, neutral, direct, and tool-like.

## Source lineage

- **Visual reference:** `OpenFDE_Hackathon/FrontEnd/src/app/styles.css` (`Inter`, cool Zinc neutrals, compact radii, subtle borders and 1px shadows).
- **Interaction reference:** Prompt Kit’s compact, composable AI interface patterns.
- **Platform foundation:** Expo, React Native, Expo Symbols, Reanimated, and selected Expo UI controls.

The separate `/Desktop/dev/OpenFDE` Studio is not the token source for GlideLingo.

The official Prompt Kit registry is built for React DOM with shadcn/ui, Tailwind CSS, and Radix. Those components are not imported into native screens. `src/components/prompt-kit-native` mirrors the relevant component responsibilities with React Native implementations.

## Principles

1. **Content creates hierarchy.** Typography, spacing, and sequence come before containers.
2. **One primary action.** A section may offer several paths, but only one should look dominant.
3. **Color communicates state.** Neutral foreground handles actions. Light blue marks the next useful action. Green means ready or complete; gold means attention or streak; red means failure or destructive action.
4. **Borders before shadows.** Use hairlines and fill changes first. Cards and floating controls may use the Hackathon system’s restrained `0 1px 2px` shadow.
5. **One type family.** Inter is used throughout. Weight, size, spacing, and hierarchy replace the previous serif/sans split.
6. **Native behavior wins.** Keep platform-native accessibility, input, tab, keyboard, and switch behavior where it improves the experience.

## Emotional behavior layer

Visual restraint does not mean emotional flatness. Use `.agents/skills/learning-behavior-design/SKILL.md` when designing progress, lesson feedback, celebrations, streaks, goals, return cues, notifications, or other motivational moments. That skill defines GlideLingo's calm-momentum emotional journey and requires every mechanic to distinguish demonstrated learning from engagement.

## Foundation

- Colors are semantic roles in `src/constants/theme.ts`; screens do not introduce raw color values.
- Colors translate the Hackathon OKLCH variables into cross-platform Zinc hex values: `#FCFCFC`/`#18181B` in light mode and `#09090B`/`#FAFAFA` in dark mode, with muted and border roles from Zinc 100–800. Light-blue accent roles (`accent`, `accentStrong`, `accentSoft`, `accentMid`) mark the next useful action.
- Spacing follows a 4-point grid with 20pt available for natural mobile rhythm.
- Controls use 6–8pt radii, content surfaces use 12pt, and large input containers use 20pt.
- Touch targets are at least 40pt, with 44–48pt preferred for primary mobile actions.
- Motion is short and low-amplitude. Reduced-motion settings must be respected.

## Component layers

### Foundation

- `ThemedText` — semantic type and color roles.
- `GlideSurface` — flat content grouping with subtle lines and fills.
- `GlideButton` — branded primary, secondary, and text actions.
- `GlideSymbol` — SF Symbols with Material Symbols/web fallbacks.
- `ProgressBar` — bounded, accessible progress.
- `GlideSwitch` — native Expo UI switch with a web fallback.

### Prompt Kit Native

- `PromptSuggestion` — compact prompt entry points.
- `PromptMessage` — distinct user and assistant message treatments.
- `ThinkingBar` — low-noise model activity with reduced-motion support.
- `PromptComposer` — multiline prompt input with one clear send action.

## Usage rules

- Do not add decorative glass, ambient color blobs, or heavy card stacks.
- A quiet two-stop light-blue wash is allowed only on the next-action surface (`GlideSurface` variant `hero`) and lesson-closure / first-demonstrated cards. Everywhere else stays a flat fill.
- Avoid a card around every section; a divider or whitespace is usually enough.
- Use uppercase eyebrow labels sparingly and keep them descriptive.
- All copy uses Inter; assistant output remains visually distinct through spacing, size, and surface treatment.
- Never communicate state with color alone.
- Every async action must define idle, working, success, cancellation, and error behavior in the same visual region.
- Test light and dark appearances, keyboard behavior, Dynamic Type, reduced motion, and screen-reader labels.
