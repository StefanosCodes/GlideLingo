# Local Development and Operations

## Current command contract

Run every command from the Git root containing `package.json` and `AGENTS.md`.

Current client commands:

| Goal | Command |
| --- | --- |
| Install locked Node dependencies | `npm ci` |
| Start interactive Expo/Metro | `npm start` |
| Start Android | `npm run android` |
| Start iOS | `npm run ios` |
| Start web | `npm run web` |
| Start Electron and its web server | `npm run desktop` |
| Attach Electron to existing Metro | `npm run desktop:window` |
| Diagnose the environment | `npm run diagnose` |
| Run fast verification | `npm run verify` |
| Run complete Expo/Electron verification | `npm run verify:full` |

These commands exist today. Backend and database commands below are planned and should not be documented as runnable until their implementation lands.

## Planned full-stack command contract

When FastAPI and PostgreSQL are introduced, root npm scripts should remain the human, CI, and Codex entrypoint.

Expected responsibilities:

| Planned goal | Intended command shape |
| --- | --- |
| Install Python dependencies | `npm run setup:backend` |
| Start local PostgreSQL | `npm run db:up` |
| Stop local PostgreSQL without deleting data | `npm run db:down` |
| Apply migrations | `npm run db:migrate` |
| Start FastAPI with development reload | `npm run api` |
| Start API, database, and interactive Expo | `npm run dev` |
| Start API, database, and Electron | `npm run dev:desktop` |
| Verify backend | `npm run api:verify` |
| Verify the entire repository | `npm run verify:full` |

Exact scripts become authoritative only when present in `package.json`. Documentation must call those scripts rather than duplicating their implementation.

## Port ownership

Do not assume common ports are available. Before assigning or stopping a process:

1. Identify the listener.
2. Confirm it belongs to GlideLingo.
3. Reuse it if it is the correct process.
4. Choose an explicit project port when another project owns the default.

Do not reserve `8000` or `5432` in documentation before implementation. Select and document GlideLingo's actual API and database ports after checking the developer environment, then keep those values consistent across scripts, examples, health checks, and client configuration.

## Platform API addresses

One central client configuration module should own the API origin.

Common local behavior:

| Client | Local host mapping |
| --- | --- |
| iOS Simulator | Usually `localhost` |
| Electron | Usually `localhost` |
| Web browser | Usually `localhost` |
| Android emulator | Usually `10.0.2.2` for the host Mac |
| Physical device | Reachable LAN address or secure development tunnel |

The exact origin must be configurable. No feature should construct its own base URL.

Only public configuration may use Expo’s `EXPO_PUBLIC_*` variables. Secrets, service credentials, signing keys, and privileged tokens must never enter a client bundle.

## Environment files

When environments are introduced:

- Commit `.env.example` with names and safe examples only.
- Ignore real `.env` files.
- Keep production secrets in the hosting/EAS/CI secret manager.
- Validate required configuration at process startup.
- Use explicit development, test, staging, and production profiles.
- Never silently use development credentials in production.

## Health and readiness

The future API should distinguish:

- Liveness: the API process is running.
- Readiness: required dependencies such as PostgreSQL are usable.

Health checks should remain cheap and must not expose secrets or detailed infrastructure errors publicly.

## Request correlation

Every API response should eventually carry a request ID. Logs should correlate the identifiers relevant to the operation, such as:

- Request ID.
- Internal user ID.
- Learning-session ID.
- Attempt ID.
- Course-version ID.
- Background-job ID.

Do not log bearer tokens, passwords, raw provider credentials, unnecessary learner text, or raw recordings.

## Debugging order

Use a causal sequence:

1. Run the repository diagnostic command.
2. Confirm the working directory.
3. Confirm the expected ports and owning processes.
4. Confirm the database container/process is healthy.
5. Confirm migrations match the running code.
6. Confirm API liveness and readiness.
7. Confirm the client’s resolved API origin.
8. Reproduce the narrow failing request.
9. Trace its request ID through API and worker logs.
10. Fix the first proven cause before chasing downstream symptoms.

For current Metro/Electron problems, continue following `AGENTS.md`: diagnose first, reuse the existing Metro server when appropriate, clear cache once when evidence points to stale state, and verify the affected runtime.

## Verification ladder

Run the cheapest relevant evidence first:

1. Focused domain or component test.
2. Affected feature tests.
3. Type checking.
4. Lint and formatting checks.
5. API contract tests.
6. PostgreSQL integration and migration tests.
7. Expo/Electron build checks.
8. Real Android, iOS, or Electron interaction.
9. Broader repository verification.

Do not declare a user-facing path complete from compilation alone.

## Operational baselines

When the backend is deployed, monitor:

- Request latency and error rate.
- Database connection use and query latency.
- Migration version.
- API and worker saturation.
- Queue age, retries, and terminal failures when workers exist.
- External-provider latency and cost.
- Client version distribution.

Add alerts for actionable failures, not every transient event.

## Safe database operations

- Migrations are versioned and reviewed.
- Local `down` commands must preserve data unless explicitly named as destructive.
- A reset command must clearly state that it deletes local data.
- Production migrations use compatible expand-and-contract ordering.
- Backups and restore procedures are verified before relying on them.
- Connection pools are budgeted across API replicas, workers, migrations, and administrative tasks.
