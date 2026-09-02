#!/usr/bin/env bash
set -euo pipefail

expected_tag="${1:-}"
expected_revision="${2:-}"

if [[ ! "${expected_tag}" =~ ^c-[0-9a-f]{19}$ || -z "${expected_revision}" ]]; then
  echo "Expected one exact candidate tag and revision." >&2
  exit 2
fi

jq -er --arg tag "${expected_tag}" --arg revision "${expected_revision}" '
  [.status.traffic[]? | select(.tag == $tag)] as $tagged
  | if ($tagged | length) == 0 then "absent"
    elif ($tagged | length) != 1 then error("candidate tag is ambiguous")
    elif ($tagged[0].revisionName // "") != $revision then error("candidate tag points to a different revision")
    elif ($tagged[0].percent // 0) != 0 then error("candidate tag is not zero traffic")
    else "remove"
    end
'
