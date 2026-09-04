import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvidenceTracker } from './evidence.mjs';

const sessionCreated = {
  type: 'session.created',
  session: {
    model: 'gpt-realtime-2.1',
    audio: {
      output: { voice: 'marin' },
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: null,
      },
    },
    tools: [],
    tool_choice: 'none',
  },
};

test('evidence waits for asynchronous transcript and audio signals in any order', async () => {
  const tracker = createEvidenceTracker({ model: 'gpt-realtime-2.1', voice: 'marin' });
  let completed = false;
  tracker.complete.then(() => { completed = true; });
  tracker.observeEvent({ type: 'response.done', response: { status: 'completed' } });
  tracker.observeEvent({ type: 'response.output_audio_transcript.done', transcript: 'Try alpha.' });
  tracker.markConnected();
  tracker.markRemoteAudioTrack();
  tracker.observeEvent(sessionCreated);
  tracker.markRemoteAudio();
  tracker.markInputFinished();
  await Promise.resolve();
  assert.equal(completed, false);
  tracker.observeEvent({ type: 'response.done', response: { status: 'completed' } });
  tracker.observeEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'άλφα',
  });
  tracker.observeEvent({ type: 'response.output_audio_transcript.done', transcript: 'Try alpha.' });
  await tracker.complete;
  assert.equal(tracker.snapshot().learnerTranscriptFinalCount, 1);
  assert.equal(tracker.diagnostics().turnDetectionDisabled, true);
  assert.equal(JSON.stringify(tracker.diagnostics()).includes('άλφα'), false);
});

test('an early complete turn cannot mask a cancelled post-input turn', async () => {
  const tracker = createEvidenceTracker({ model: 'gpt-realtime-2.1', voice: 'marin' });
  tracker.markConnected();
  tracker.markRemoteAudioTrack();
  tracker.markRemoteAudio();
  tracker.observeEvent(sessionCreated);
  tracker.observeEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'early learner turn',
  });
  tracker.observeEvent({ type: 'response.output_audio_transcript.done', transcript: 'Early reply.' });
  tracker.observeEvent({ type: 'response.done', response: { status: 'completed' } });
  let completed = false;
  tracker.complete.then(() => { completed = true; }, () => {});
  await Promise.resolve();
  assert.equal(completed, false);
  tracker.markInputFinished();
  tracker.observeEvent({ type: 'response.done', response: { status: 'cancelled' } });
  await assert.rejects(tracker.complete, /did not complete successfully/);
});

test('evidence rejects failed responses and ignores empty transcripts', async () => {
  const tracker = createEvidenceTracker({ model: 'gpt-realtime-2.1', voice: 'marin' });
  tracker.observeEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: '   ',
  });
  assert.equal(tracker.snapshot().learnerTranscriptFinalCount, 0);
  tracker.observeEvent({ type: 'response.done', response: { status: 'cancelled' } });
  await assert.rejects(tracker.complete, /did not complete successfully/);
});
