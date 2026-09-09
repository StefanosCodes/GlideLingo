import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const resetPath = new URL("../../infra/gcp/scripts/reset-local-application-data.sh", import.meta.url);
const preparePath = new URL("./prepare-local-desktop-journey.sh", import.meta.url);

test("local reset is isolated from production and preserves the Docker volume", async () => {
  const script = await readFile(resetPath, "utf8");
  assert.match(script, /expected_confirmation="glidelingo-local"/);
  assert.match(script, /infra\/compose\.yaml/);
  assert.match(script, /DELETE FROM public\.lesson_tutor_turn_guard/);
  assert.match(script, /DELETE FROM public\.revenuecat_webhook_event/);
  assert.match(script, /DELETE FROM public\.revenuecat_entitlement_state/);
  assert.doesNotMatch(script, /\bgcloud\b/);
  assert.doesNotMatch(script, /down\s+--volumes|\bDROP\b|\bTRUNCATE\b/);
});

test("local preparation invokes only the local reset and diagnostics", async () => {
  const script = await readFile(preparePath, "utf8");
  assert.match(script, /expected_confirmation="glidelingo-local"/);
  assert.match(script, /reset-local-application-data\.sh/);
  assert.match(script, /scripts\/diagnose\.mjs/);
  assert.doesNotMatch(script, /reset-production|glidelingo-prod|glidelingo\.com/);
});
