#!/usr/bin/env bash
set -euo pipefail

export UV_CACHE_DIR="${UV_CACHE_DIR:-${TMPDIR:-/tmp}/glidelingo-uv-cache}"

valid_cors='["https://desktop.glidelingo.com"]'
valid_parties='["https://desktop.glidelingo.com"]'

GLIDELINGO_CORS_ORIGINS="${valid_cors}" \
GLIDELINGO_CLERK_ISSUER=https://clerk.glidelingo.com \
GLIDELINGO_CLERK_JWKS_URL=https://clerk.glidelingo.com/.well-known/jwks.json \
GLIDELINGO_CLERK_AUTHORIZED_PARTIES="${valid_parties}" \
  uv run --directory backend --locked python -c '
from app.core.config import Settings
settings = Settings(_env_file=None)
assert settings.normalized_cors_origins == ["https://desktop.glidelingo.com"]
assert settings.clerk_authorized_parties == ("https://desktop.glidelingo.com",)
'

if GLIDELINGO_CORS_ORIGINS='["https://desktop.glidelingo.com/unsafe"]' \
  uv run --directory backend --locked python -c 'from app.core.config import Settings; Settings(_env_file=None)' \
  >/dev/null 2>&1; then
  echo "Production settings accepted a CORS origin with a path." >&2
  exit 1
fi

echo "Production FastAPI CORS and Clerk settings contracts passed."
