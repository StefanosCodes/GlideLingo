# GlideLingo Infrastructure and Architecture Guide

This folder is the durable reference for how GlideLingo should grow from the current Expo and Electron client into a full-stack product.

It describes intended boundaries and implementation order. It does **not** mean every illustrated folder, service, database table, or deployment pipeline exists today.

## Current reality

The repository currently contains:

- One Expo SDK 57 application for Android, iOS, and web.
- One Electron shell that packages the Expo web output as a macOS desktop app.
- Shared TypeScript UI, routes, design tokens, and platform-specific component files.
- Canonical npm commands, environment diagnostics, and Electron verification.

The repository does **not** currently contain:

- FastAPI or other backend application code.
- PostgreSQL, migrations, or persisted product data.
- Authentication or authorization.
- A generated API client.
- Background workers, Redis, or object storage.
- Mobile-store or signed/notarized desktop release automation.

## Settled direction

GlideLingo will use a pragmatic modular-monolith architecture:

```text
Shared Expo product
├── Android native app
├── iOS native app
├── Web app
└── Electron desktop app using the web bundle

Shared clients
    ↓
FastAPI modular monolith
    ↓
PostgreSQL

Durable workers and object storage are added only for work that needs them.
```

The repository remains one monorepo, while mobile, desktop, API, workers, and migrations remain independently buildable and deployable artifacts.

## Read this documentation in order

1. [System architecture](./SYSTEM-ARCHITECTURE.md) explains the major components, boundaries, and state ownership.
2. [Folder structure](./FOLDER-STRUCTURE.md) explains where current and future code belongs.
3. [Feature development](./FEATURE-DEVELOPMENT.md) shows the repeatable end-to-end design pattern.
4. [Local development and operations](./LOCAL-DEVELOPMENT.md) defines commands, environments, debugging, and observability.
5. [Deployment](./DEPLOYMENT.md) separates iOS, Android, macOS, web, API, database, and worker release lanes.
6. [Implementation roadmap](./IMPLEMENTATION-ROADMAP.md) defines the order in which the architecture should become real.

## Architecture principles

### Build vertical slices

Implement one complete product capability through every layer it actually needs. Do not create all future layers before the first feature uses them.

### Earn every boundary

A new module, service, interface, queue, cache, repository, or package must solve a current problem. “We may need it later” is not enough.

### Share product behavior by default

Android, iOS, web, and Electron should share routes, feature behavior, domain rules, and UI primitives. Platform files exist only where capabilities or interaction genuinely differ.

### Keep ownership obvious

Routes compose features. Features own product behavior. Shared UI owns reusable presentation. FastAPI modules own server behavior. PostgreSQL owns durable product truth.

### Prefer deterministic behavior

Curriculum sequencing, scoring, mastery, review scheduling, authorization, and data constraints should be deterministic. AI may assist practice and authoring, but it does not own the curriculum spine or critical invariants.

### Preserve deployability

One repository does not imply one deployment. Every artifact has its own build, credentials, verification, and release gate.

## Decision summary

| Area | Direction | Revisit when |
| --- | --- | --- |
| Repository | One monorepo | Multiple independently owned repositories become operationally necessary |
| Client | One Expo application | A target cannot meet product requirements through supported platform boundaries |
| Desktop | Electron wrapping Expo web | Measured package, memory, security, or platform requirements justify migration |
| Backend | FastAPI modular monolith | A module has proven independent scaling, ownership, isolation, or release needs |
| Database | One PostgreSQL database | A real service extraction establishes separate data ownership |
| UI system | Existing custom primitives | A focused spike proves another system solves a current problem better |
| Server state | Generated API contracts plus a remote-data cache | A simpler direct call is sufficient for a tiny bounded path |
| Workers | None initially | Work must survive request/process failure, retry, or scale independently |
| Redis | None initially | A measured queue, cache, shared limit, or coordination need exists |
| Content | Versioned authored source published immutably | Editorial workflow demonstrates a better accountable process |

## Rule for future changes

Before implementing a feature, read [Feature development](./FEATURE-DEVELOPMENT.md), inspect the repository’s actual current state, and build the smallest coherent slice. These documents guide decisions; they are not permission to scaffold unrelated future systems.
