export function createEvidenceTracker({ model, voice }) {
  const state = {
    connected: false,
    providerConfigurationObserved: false,
    remoteAudioTrackReceived: false,
    remoteAudioObserved: false,
    inputFinished: false,
    postInputLearnerTranscript: false,
    postInputCoachTranscript: false,
    postInputResponseCompleted: false,
    learnerTranscripts: [],
    coachTranscripts: [],
    responseCompletedCount: 0,
  };
  let resolveComplete;
  let rejectComplete;
  let settled = false;
  const complete = new Promise((resolvePromise, rejectPromise) => {
    resolveComplete = resolvePromise;
    rejectComplete = rejectPromise;
  });

  const maybeComplete = () => {
    if (settled) return;
    if (
      state.connected &&
      state.providerConfigurationObserved &&
      state.remoteAudioTrackReceived &&
      state.remoteAudioObserved &&
      state.inputFinished &&
      state.postInputLearnerTranscript &&
      state.postInputCoachTranscript &&
      state.postInputResponseCompleted
    ) {
      settled = true;
      resolveComplete();
    }
  };
  const fail = (message) => {
    if (settled) return;
    settled = true;
    rejectComplete(new Error(message));
  };
  const addTranscript = (collection, transcript) => {
    if (typeof transcript === 'string' && transcript.trim() && collection.length < 4) {
      collection.push(transcript.slice(0, 4000));
      maybeComplete();
    }
  };

  return {
    complete,
    markConnected() {
      state.connected = true;
      maybeComplete();
    },
    markRemoteAudioTrack() {
      state.remoteAudioTrackReceived = true;
      maybeComplete();
    },
    markRemoteAudio() {
      state.remoteAudioObserved = true;
      maybeComplete();
    },
    markInputFinished() {
      state.inputFinished = true;
      maybeComplete();
    },
    observeEvent(event) {
      if (!event || typeof event.type !== 'string') return;
      if (event.type === 'session.created') {
        const session = event.session;
        state.providerConfigurationObserved =
          session?.model === model &&
          session?.audio?.output?.voice === voice &&
          session?.audio?.input?.transcription?.model === 'gpt-4o-mini-transcribe' &&
          Array.isArray(session?.tools) && session.tools.length === 0 &&
          session?.tool_choice === 'none';
        maybeComplete();
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        addTranscript(state.learnerTranscripts, event.transcript);
        if (state.inputFinished && typeof event.transcript === 'string' && event.transcript.trim()) {
          state.postInputLearnerTranscript = true;
          maybeComplete();
        }
      }
      if (event.type === 'response.output_audio_transcript.done') {
        addTranscript(state.coachTranscripts, event.transcript);
        if (state.inputFinished && typeof event.transcript === 'string' && event.transcript.trim()) {
          state.postInputCoachTranscript = true;
          maybeComplete();
        }
      }
      if (event.type === 'response.done') {
        if (event.response?.status !== 'completed') {
          fail('OpenAI response did not complete successfully.');
          return;
        }
        state.responseCompletedCount += 1;
        if (state.inputFinished) state.postInputResponseCompleted = true;
        maybeComplete();
      }
      if (event.type === 'error') fail('OpenAI emitted a Realtime error event.');
    },
    snapshot() {
      return {
        ...state,
        learnerTranscripts: [...state.learnerTranscripts],
        coachTranscripts: [...state.coachTranscripts],
        learnerTranscriptFinalCount: state.learnerTranscripts.length,
        coachTranscriptFinalCount: state.coachTranscripts.length,
      };
    },
  };
}
