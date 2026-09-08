#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
expected_confirmation="glidelingo-local"

if [[ "${1:-}" != "--confirm" || "${2:-}" != "${expected_confirmation}" || $# -ne 2 ]]; then
  echo "Usage: npm run e2e:local:prepare -- --confirm ${expected_confirmation}" >&2
  exit 1
fi

"${root}/infra/gcp/scripts/reset-local-application-data.sh" "$@"
node "${root}/scripts/diagnose.mjs"
echo "Local data is reset and prerequisites are ready. Start the API, Expo web server, and Electron with one isolated profile for the visible journey."
