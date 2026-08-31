# Folder Structure

## Purpose

This document describes where code belongs as GlideLingo grows. It distinguishes the current repository from the future structure.

Do not create every folder shown below at once. Create a folder when the first working feature needs it.

## Current structure

```text
GlideLingo/
├── src/
│   ├── app/                  Expo Router routes
│   ├── components/           Shared components
│   │   └── ui/               Design-system primitives
│   ├── constants/            Theme tokens
│   ├── hooks/                Shared hooks
│   ├── api/                  Shared HTTP transport boundary
│   ├── config/               Public runtime configuration
│   ├── features/
│   │   └── system-status/    Internal end-to-end diagnostics
│   └── types/                Cross-cutting TypeScript declarations
├── desktop/                  Electron shell, tests, and builder config
├── backend/                  FastAPI health/readiness service and tests
├── infra/                    Local PostgreSQL Compose configuration
├── .github/workflows/        Pull-request verification
├── assets/                   Client images, icons, and fonts
├── scripts/                  Diagnostics and project scripts
├── .agents/                  Repository-specific agent skills
├── .codex/                   Codex environment actions
├── AGENTS.md                 Mandatory repository guidance
├── DESIGN_SYSTEM.md          UI-system reference
├── README.md                 Human quickstart
└── package.json              Current command source of truth
```

## Target structure

```text
GlideLingo/
├── src/
│   ├── app/                          Thin Expo Router routes
│   │   ├── _layout.tsx
│   │   ├── (auth)/                   Added with authentication
│   │   └── (app)/                    Added as product navigation grows
│   │       ├── _layout.tsx
│   │       ├── index.tsx             Home route
│   │       ├── path.tsx
│   │       ├── review.tsx
│   │       ├── progress.tsx
│   │       └── lesson/[sessionId].tsx
│   │
│   ├── features/                     Product behavior by capability
│   │   ├── onboarding/
│   │   ├── today/
│   │   ├── learning-session/
│   │   ├── review/
│   │   ├── progress/
│   │   ├── speaking/
│   │   └── conversations/
│   │
│   ├── components/
│   │   └── ui/                       Product-agnostic UI primitives
│   ├── api/
│   │   ├── generated/                Generated from OpenAPI; never hand-edited
│   │   ├── client.ts                 Base URL, token, timeout, request metadata
│   │   └── errors.ts                 One transport-error translation
│   ├── config/                       Public runtime configuration
│   ├── platform/                     Real platform capability boundaries
│   ├── providers/                    Focused cross-tree providers
│   ├── constants/
│   └── hooks/                        Only genuinely shared hooks
│
├── desktop/                          Thin Electron host
├── backend/                          Added by the full-stack walking skeleton
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py                   Composition root
│   │   ├── api/                      Shared API dependencies/router composition
│   │   ├── core/                     Config, errors, logging, security
│   │   ├── db/                       Engine/session/base configuration
│   │   ├── modules/                  Cohesive backend product modules
│   │   └── integrations/             Identity, speech, model, storage adapters
│   ├── migrations/                   Added with the first product schema
│   └── tests/
│       ├── unit/
│       └── integration/
│
├── content/                          Added with the first reviewed Greek mission
│   ├── schemas/
│   └── courses/
│       └── en-el-GR/
│           ├── course.yaml
│           ├── skills/
│           ├── missions/
│           ├── lexicon/
│           └── audio-manifest.yaml
│
├── infra/                            Added with local/deployment infrastructure
│   └── compose.yaml                  PostgreSQL first; other services only as needed
├── docs/
│   └── infra/                        These architecture references
├── scripts/
├── AGENTS.md
├── README.md
└── package.json                      Repository command center
```

## Frontend feature shape

A feature gets only the files it needs. A substantial learning-session feature might eventually look like:

```text
src/features/learning-session/
├── learning-session-screen.tsx
├── queries.ts
├── mutations.ts
├── components/
│   ├── activity-frame.tsx
│   └── activities/
│       ├── multiple-choice.tsx
│       └── typed-response.tsx
├── domain/
│   ├── reducer.ts
│   └── scoring.ts
└── __tests__/
    ├── reducer.test.ts
    └── scoring.test.ts
```

Do not add `queries.ts` before the feature queries remote data. Do not add `service.ts` merely to wrap another function. Do not add an index barrel if it obscures ownership or creates circular imports.

## Backend module shape

A backend module may contain:

```text
backend/app/modules/learning/
├── router.py             HTTP adaptation only
├── schemas.py            Public request and response models
├── domain.py             Deterministic learning rules when needed
├── service.py            Multi-step use-case coordination when needed
├── queries.py            Feature-specific persistence operations
└── models.py             Tables and durable models owned by learning
```

Each file must have a current responsibility:

- No `service.py` for a one-line pass-through.
- No generic repository for simple SQLAlchemy operations.
- No domain layer for behavior that is only transport validation.
- No database model returned directly as a public response.

## Dependency rules

```text
Routes
  ↓
Features
  ↓
Shared UI / API boundary / named infrastructure

FastAPI composition
  ↓
Feature routers
  ↓
Feature application/domain behavior
  ↓
Feature queries and PostgreSQL
```

Allowed:

- A route imports a feature screen.
- A feature imports shared UI and its own internals.
- A feature query imports the generated API client.
- A backend router imports schemas and one cohesive operation.
- An application operation imports feature-specific queries.

Avoid:

- Shared UI importing a feature.
- One feature deep-importing another feature’s internals.
- Domain code importing React, FastAPI, or HTTP objects.
- Routers containing multi-step business workflows or ad hoc SQL.
- Cross-module database access that bypasses the owning module’s contract.
- `utils.ts`, `helpers.py`, or `common/` accumulating unrelated behavior.

## Cross-feature behavior

When one feature needs another:

1. Prefer navigation or a stable public operation.
2. Move a rule to a named domain module only if it truly has shared ownership.
3. Compose a multi-feature workflow at an application boundary.
4. Do not expose every internal function through a barrel to make imports convenient.

## Platform files

Use standard shared files first:

```text
component.tsx
```

Add variants only where behavior differs:

```text
component.ios.tsx
component.android.tsx
component.web.tsx       Used by browser and Electron
```

Do not fork an entire feature merely because desktop layout differs. Share the feature’s domain and data hooks, then provide a platform-specific composition component at the narrowest boundary.

## Tests

- Colocate focused frontend tests with the feature when practical.
- Keep backend unit tests separate from database integration tests.
- Test public contracts and behavior, not folder wiring.
- Add platform-specific tests for files that contain platform-specific behavior.
- Add end-to-end coverage only for critical flows that unit or contract tests cannot prove.

## When to introduce workspaces

Do not move the existing Expo project into `apps/client` merely to imitate a large monorepo.

Consider npm/Python workspace machinery only when there are multiple independently built packages with real shared dependencies or ownership. Until then, the current root Expo application plus named top-level backend/content/infra directories is clearer.
