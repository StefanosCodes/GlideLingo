# Direct OpenAI Realtime Voice

Status: review candidate; dormant and disabled by default

## Approved scope

Core V1 Voice is one optional, lesson-linked practice path using direct OpenAI Realtime WebRTC in
a supported web browser. It provides microphone consent, muted-by-default push-to-talk, live
captions, response interruption, bounded reconnect, explicit end/error states, and safe teardown.

There is no HeyGen, LiveAvatar, avatar, generated video, LiveKit, separate streaming STT/TTS
provider, or platform video dependency. iOS, Android, and Electron fail closed until their actual
transport is separately implemented and verified.

## Runtime boundary

```text
supported web browser
  -> authenticated public /v1/voice-sessions control plane
  -> IAM-private lesson-tutor voice boundary
  -> OpenAI /v1/realtime/calls
  -> SDP answer, provider audio, and normalized captions in the browser
```

The public API verifies Clerk identity and server-owned Pro entitlement before admission. It owns
application session IDs, actor-scoped idempotency and replay handling, one-active-session limits,
expiry, reconnect, recap, and provider cleanup. The IAM-private tutor holds the OpenAI key,
resolves the authored scenario, selects the model and voice, supplies a privacy-preserving safety
identifier, and hangs up the provider call.

The browser receives only the SDP answer and server-resolved `VoiceSessionSpec`; the OpenAI API
key and provider call ID remain server-side. Current OpenAI guidance documents this unified
server-mediated WebRTC flow and the Calls create/hangup endpoints:

- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Create a Realtime call](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/calls/methods/create)
- [Hang up a Realtime call](https://developers.openai.com/api/reference/python/resources/realtime/subresources/calls/methods/hangup)

## Three independent flags

All switches default to `false`:

| Boundary | Flag | A lone `true` value does |
| --- | --- | --- |
| Browser UI | `EXPO_PUBLIC_VOICE_ENABLED` | Shows the lesson entry only on supported web; no server admission bypass. |
| Public API | `GLIDELINGO_VOICE_ENABLED` | Enables the authenticated control plane only when Clerk, server entitlement, private URL/audience, and pseudonym configuration also validate. |
| Private tutor | `GLIDELINGO_TUTOR_VOICE_ENABLED` | Constructs the private provider adapter only with an OpenAI key plus explicit Realtime model and voice. |

No single switch creates a working browser-to-provider session. Activation requires a reviewed,
coordinated rollout of every boundary after the gates below pass.

## Published Course binding

Lesson-linked Voice resolves only an allowlisted authored scenario connected to the existing
course lesson and capability. The Voice publication record is rejected unless it is `published`,
has a passing validator result, has an aware publication timestamp, contains the exact required
approved reviews, and its SHA-256 digest matches the exact lesson and scenario bytes. That digest
is returned in `VoiceSessionSpec.course_content_hash`, binding admission and reconnect to one
immutable authored revision.

The checked-in publication is intentionally `draft`; it is an external enablement gate, not a
placeholder admitted at runtime. Draft, retired, missing, malformed, incomplete-review, invalid
timestamp, and hash-mismatched content all fail closed by default.

## Trust, learning authority, and retention

- The provider session is audio-only and explicitly has no tools; tool choice is `none`.
- Provider events are allowlisted, normalized, length-bounded, ordered, deduplicated, and kept in
  a bounded in-memory client window. They are not authoritative evidence.
- Voice never writes mastery, progress, XP, course completion, or grading.
- `retain_transcript=false` is the only admitted request. End and recap responses contain an empty
  transcript, including idempotent replays; transcript text is not persisted by this slice.
- Provider output and the browser-owned data channel are untrusted. Client attempts to alter the
  provider session remain a mandatory hostile acceptance test before enablement.

## Reliability and rollback

Client connection establishment has one total deadline spanning microphone acquisition, SDP
preparation, API admission, remote description, and data-channel opening. Public-to-private and
private-to-provider calls have shorter nested deadlines. Cancellation, superseded attempts,
provider errors, reconnect replacement, unmount, and session expiry stop local media and request
server/provider cleanup; expiry is the final backstop.

The current session registry is process-local and deliberately bounded. It is safe for disabled
review and deterministic local tests, but not for multi-instance enablement. The three flags can
prevent admission only at process startup; restarting the public API discards its in-memory cleanup
references. If this slice is exercised locally, every admitted session must be explicitly ended and
provider cleanup confirmed before a disabled restart. A deployable rollback requires durable
ownership plus an operator-visible admission-drain and cleanup procedure before any environment is
enabled.

An ambiguous provider-create timeout can mean OpenAI accepted a call before its response and cleanup
reference were lost. Public idempotency prevents duplicate application admissions only after the
private response returns; it cannot yet prove provider-side deduplication or recover that orphan.
This is another reason the slice must remain disabled until durable ownership and reconciliation
exist.

## Verification and activation gates

Code may merge disabled after repository verification and a fake/local browser smoke. It must not
be deployed or enabled until all of these pass independently:

1. The Voice Course publication is genuinely reviewed, validated, hashed, and published.
2. A real supported-browser journey with approved OpenAI credentials proves microphone consent,
   muted start, captions, interruption, reconnect, timeout, end, provider failure, and cleanup.
3. Hostile browser tests attempt `session.update`, client-created system items, malformed and
   replayed events, and confirm there are still no consequential tools or learning mutations.
4. Server-enforced rate, daily usage, concurrency, cost telemetry, and abuse controls exist.
5. Durable multi-instance ownership, provider-create reconciliation, terminal cleanup, and a
   rehearsed admission-drain procedure replace the process-local registry.
6. The deployed IAM-private boundary and real Clerk/RevenueCat authorization path pass acceptance.
7. Operational dashboards, alerts, rollback rehearsal, privacy review, and learner-safe copy are
   approved for the target environment.

A fake/local browser smoke proves browser lifecycle and UI wiring without vendor credentials. It
does not prove OpenAI availability, model behavior, audio quality, latency, cost, quota, policy, or
the production identity and entitlement journey.

## Opt-in live provider smoke

`npm run voice:test:live` is a local-only, paid acceptance check. It feeds the existing authored
Greek course audio into the production browser WebRTC adapter, resolves an isolated temporary
published Course fixture through the private tutor, opens a real OpenAI Realtime call, confirms
provider transcription and returned audio, explicitly hangs up, and prints only bounded metadata.
It never changes the checked-in draft publication and is not part of normal CI.

The command deliberately does not auto-load `.env`. It fails closed unless the opt-in,
confirmation, and key are explicitly supplied in the environment of that one invocation:

```text
GLIDELINGO_VOICE_LIVE_TEST=true
GLIDELINGO_VOICE_TEST_CONFIRM_SPEND=I_ACCEPT_BOUNDED_OPENAI_TEST_SPEND
GLIDELINGO_VOICE_TEST_OPENAI_API_KEY=<dedicated-test-project-key>
```

Set `GLIDELINGO_VOICE_TEST_OPENAI_PROJECT_ID` as well when the key is not an `sk-proj-` project-scoped
key. Legacy or service keys without an explicit project ID are rejected.

The evaluation uses `gpt-realtime-2.1`, the `marin` voice, a hard limit of sixteen serial Realtime
sessions, and a 45-second deadline per conversation. Four fixed tuning clips establish the
baseline and evaluate two bounded authored-scenario candidates; two separate holdout clips compare
the baseline with only a candidate that clears the tuning threshold. It also makes at most six paid
Responses API requests for candidate generation and grading. A `gpt-5.6-terra` grader receives
transcripts only in memory with `store=false`. The candidate generator may propose changes only to
the scenario's persona, opening, and safe exits. It cannot modify source files, allowed vocabulary,
tools, grading, progress, or production flags.

The credential remains server-side. Child environments are scrubbed before Chrome and compilation;
only the private tutor receives it as `OPENAI_API_KEY`, while the runner uses it for grader requests.
Raw audio and transcript text are not written to the report and are discarded with the temporary
browser profile and process. The ignored `.voice-live/latest.json` report contains transport
counts, rubric summaries, the bounded candidate fields, and the exact Git head. OpenAI's own API
data controls still apply to the dedicated provider project.

This smoke proves the real browser-to-provider media path and private provider configuration. It
uses synthetic local admission and therefore does not prove deployed IAM, Clerk, RevenueCat,
multi-instance ownership, rate/cost enforcement, or the final human microphone experience. Those
remain separate activation gates.
