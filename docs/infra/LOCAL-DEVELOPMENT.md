# Local Development and Operations

## Command contract

Run every command from the Git root containing `package.json` and `AGENTS.md`.

Current client commands:

| Goal | Command |
| --- | --- |
| Install locked Node dependencies | `npm ci` |
| Install locked Python dependencies | `npm run setup:backend` |
| Start local PostgreSQL | `npm run db:up` |
| Stop PostgreSQL and preserve its data | `npm run db:down` |
| Follow PostgreSQL logs | `npm run db:logs` |
| Start FastAPI | `npm run api` |
| Start database, API, and interactive Expo | `npm run dev` |
| Start database, API, and Electron | `npm run dev:desktop` |
| Start interactive Expo/Metro | `npm start` |
| Start Android | `npm run android` |
| Start iOS | `npm run ios` |
| Start web | `npm run web` |
| Start Electron and its web server | `npm run desktop` |
| Attach Electron to existing Metro | `npm run desktop:window` |
| Diagnose the environment | `npm run diagnose` |
| Run fast verification | `npm run verify` |
| Verify the backend without PostgreSQL | `npm run api:verify` |
| Run static/full repository verification | `npm run verify:full` |
| Add real PostgreSQL integration verification | `npm run verify:full-stack` |

These root scripts are the source of truth for humans, CI, and coding agents. There is no migration command because this slice creates no product schema.

## Port ownership

Do not assume common ports are available. Before assigning or stopping a process:

1. Identify the listener.
2. Confirm it belongs to GlideLingo.
3. Reuse it if it is the correct process.
4. Choose an explicit project port when another project owns the default.

GlideLingo deliberately avoids ports already owned by other local projects:

| Service | Default port | Binding |
| --- | --- | --- |
| Expo/Metro | `8081` | Existing Expo behavior |
| FastAPI | `8123` | `0.0.0.0` so physical devices can connect |
| PostgreSQL | `55433` | `127.0.0.1` only |

Recheck ownership before stopping a listener. `GLIDELINGO_DB_PORT` may override the database host port, and `EXPO_PUBLIC_API_BASE_URL` may override the client API origin.

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

The backend reads the root `.env` file when present, and Docker Compose reads the same file. The committed local defaults require no file. Copy `.env.example` to `.env` only for explicit overrides, and keep `GLIDELINGO_DATABASE_URL`, `GLIDELINGO_DB_PORT`, and `GLIDELINGO_DB_PASSWORD` consistent.

Environment rules:

- Commit `.env.example` with names and safe examples only.
- Ignore real `.env` files.
- Keep production secrets in the hosting/EAS/CI secret manager.
- Validate required configuration at process startup.
- Use explicit development, test, staging, and production profiles.
- Never silently use development credentials in production.

## Health and readiness

The API distinguishes:

- `GET /health/live`: the API process is running; it never queries PostgreSQL.
- `GET /health/ready`: PostgreSQL accepts a cheap `SELECT 1`; unavailable dependencies return `503` with a stable, safe error envelope.

Every response includes a server-generated `X-Request-ID`. Health checks remain cheap and never expose credentials, SQL, connection hosts, or stack traces.

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
