#!/usr/bin/env bash
set -euo pipefail

candidate_tag="${1:-}"
desktop_minimum_mode="${2:-strict}"

case "${desktop_minimum_mode}" in
  strict|allow-missing-default) ;;
  *)
    echo "Invalid desktop minimum mode ${desktop_minimum_mode}." >&2
    exit 2
    ;;
esac

jq -ce \
  --arg candidate_tag "${candidate_tag}" \
  --arg desktop_minimum_mode "${desktop_minimum_mode}" '
  (.metadata.generation | tostring) as $generation
  | (.status.observedGeneration | tostring) as $observed
  | [.status.traffic[]? | select((.percent // 0) == 100)] as $live
  | [.spec.template.spec.containers[0].env[]? |
      select(.name == "GLIDELINGO_REVENUECAT_ENABLED") | (.value // "")] as $enabled
  | [.spec.template.spec.containers[0].env[]? |
      select(.name == "GLIDELINGO_REVENUECAT_ENVIRONMENT") | (.value // "")] as $environment
  | [.spec.template.spec.containers[0].env[]? |
      select(.name == "GLIDELINGO_CORS_ORIGINS") | (.value // "")] as $cors
  | [.spec.template.spec.containers[0].env[]? |
      select(.name == "GLIDELINGO_DESKTOP_MINIMUM_SUPPORTED_VERSION") | (.value // "")] as $desktop_minimum
  | (if $desktop_minimum_mode == "allow-missing-default" and ($desktop_minimum | length) == 0
      then ["0.0.0"]
      else $desktop_minimum
    end) as $resolved_desktop_minimum
  | (if $candidate_tag == "" then [] else [.status.traffic[]? | select(.tag == $candidate_tag)] end) as $candidate
  | if ($generation | test("^[1-9][0-9]*$")) | not then error("invalid generation")
    elif $observed != $generation then error("generation is not observed")
    elif ($live | length) != 1 or ($live[0].revisionName // "") == "" then error("expected exactly one 100% revision")
    elif (.status.url // "") == "" then error("missing service URL")
    elif ($enabled | length) != 1 or ($enabled[0] != "true" and $enabled[0] != "false") then error("invalid RevenueCat enabled flag")
    elif ($environment | length) != 1 or ($environment[0] != "SANDBOX" and $environment[0] != "PRODUCTION") then error("invalid RevenueCat environment")
    elif ($cors | length) != 1 or $cors[0] != "[\"https://desktop.glidelingo.com\"]" then error("invalid production CORS origins")
    elif ($resolved_desktop_minimum | length) != 1 or ($resolved_desktop_minimum[0] | length) > 64 or (($resolved_desktop_minimum[0] | test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$")) | not) then error("invalid desktop minimum supported version")
    elif $candidate_tag != "" and (($candidate | length) != 1 or ($candidate[0].revisionName // "") == "" or ($candidate[0].url // "") == "" or ($candidate[0].percent // 0) != 0) then error("invalid zero-traffic candidate")
    else {
      generation: $generation,
      live_revision: $live[0].revisionName,
      service_url: .status.url,
      revenuecat_enabled: $enabled[0],
      revenuecat_environment: $environment[0],
      cors_origins: $cors[0],
      desktop_minimum_supported_version: $resolved_desktop_minimum[0],
      candidate_revision: (if $candidate_tag == "" then null else $candidate[0].revisionName end),
      candidate_url: (if $candidate_tag == "" then null else $candidate[0].url end)
    }
    end
'
