#!/usr/bin/env bash
set -euo pipefail

if (( $# != 2 )); then
  echo "Usage: $0 PREVIOUS_REVISION_FLAG CURRENT_TEMPLATE_FLAG" >&2
  exit 2
fi

readonly previous_flag="$1"
readonly template_flag="$2"

case "${previous_flag}:${template_flag}" in
  __missing__:__missing__|__missing__:false|false:false)
    printf '%s\n' false
    ;;
  true:true)
    printf '%s\n' true
    ;;
  *)
    echo "RevenueCat deploy state is not a permitted legacy-disabled bootstrap or exact steady state." >&2
    exit 1
    ;;
esac
