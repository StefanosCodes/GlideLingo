# Local development desktop journey

## Acceptance graph

`local table reset → verified development configuration → local PostgreSQL/API/Expo → isolated Electron profile → new Clerk development account → OTP → onboarding → quit/relaunch with the same profile`

Local mode exercises current source code and local services. It intentionally does not prove the
public website, published DMG, signing, notarization, updater, or production infrastructure.

## Isolation contract

- Database: Docker Compose service `db`, database/user `glidelingo`, loopback port `55433`
- API: repository FastAPI service on loopback port `8123`
- Renderer: Expo web development server on loopback port `8081`
- Desktop: source Electron from the selected worktree
- Client state: a new temporary Electron `--user-data-dir`, retained across the one relaunch and
  removed during teardown
- Identity: the configured Clerk development instance; use a never-before-used email for signup

The local reset preserves the Docker volume and schema and deletes rows only from the three reviewed
application tables when they exist. An absent dormant-feature table counts as clean. Never use
`docker compose down --volumes` for this journey.

## Required evidence

- Exact worktree path and SHA
- Local reset output with every reviewed table empty or absent
- Non-secret environment check and port ownership
- Visible signed-out Electron state from the isolated profile
- Signup, OTP, onboarding, authenticated landing state, quit, relaunch, and restored state
- Correlated API/runtime errors, if any, with credentials and tokens redacted

## Teardown

Stop only processes started by this run. Preserve the Docker data volume. Remove only the exact
temporary Electron profile created for the run, after the relaunch evidence is captured.
