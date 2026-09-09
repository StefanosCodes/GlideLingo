#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
expected_project="glidelingo-prod-50843312405"

if [[ "${1:-}" != "--confirm" || "${2:-}" != "${expected_project}" || $# -ne 2 ]]; then
  echo "Usage: npm run e2e:production:prepare -- --confirm ${expected_project}" >&2
  exit 1
fi

"${root}/infra/gcp/scripts/reset-production-application-data.sh" "$@"
node "${root}/scripts/e2e/public-desktop-release.mjs" resolve
echo "Production is reset and the public desktop release contract is ready for the visible journey."
