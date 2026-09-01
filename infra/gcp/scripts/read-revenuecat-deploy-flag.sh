#!/usr/bin/env bash
set -euo pipefail

if (( $# != 1 )); then
  echo "Usage: $0 service|revision" >&2
  exit 2
fi

readonly resource_kind="$1"

jq -r --arg resource_kind "${resource_kind}" '
  def classify:
    if length == 0 then "__missing__"
    elif length == 1
      and (.[0].value | type) == "string"
      and (.[0].value == "true" or .[0].value == "false") then .[0].value
    else "__invalid__"
    end;
  if $resource_kind == "service" then
    [(.spec.template.spec.containers[0].env // .spec.template.containers[0].env // [])[]? |
      select(.name == "GLIDELINGO_REVENUECAT_ENABLED")]
  elif $resource_kind == "revision" then
    [.spec.containers[0].env[]? | select(.name == "GLIDELINGO_REVENUECAT_ENABLED")]
  else
    error("unsupported resource kind")
  end
  | classify
'
