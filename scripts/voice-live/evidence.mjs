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
    receivedEventCount: 0,
    sessionCreatedObserved: false,
    sessionModelMatches: false,
    sessionVoiceMatches: false,
    transcriptionConfigured: false,
    transcriptionModelMatches: false,
    toolsDisabled: false,
    toolChoiceNone: false,
    turnDetectionDisabled: false,
    responseDoneCompleted: false,
    responseDoneCancelled: false,
    responseDoneFailed: false,
    responseDoneIncomplete: false,
    responseLimitReached: false,
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
      state.receivedEventCount += 1;
      if (event.type === 'session.created') {
        state.sessionCreatedObserved = true;
        const session = event.session;
        state.sessionModelMatches = session?.model === model;
        state.sessionVoiceMatches = session?.audio?.output?.voice === voice;
        state.transcriptionConfigured = session?.audio?.input?.transcription != null;
        state.transcriptionModelMatches =
          session?.audio?.input?.transcription?.model === 'gpt-4o-mini-transcribe';
        state.toolsDisabled = Array.isArray(session?.tools) && session.tools.length === 0;
        state.toolChoiceNone = session?.tool_choice === 'none';
        state.turnDetectionDisabled = session?.audio?.input?.turn_detection === null;
        state.providerConfigurationObserved =
          state.sessionModelMatches &&
          state.sessionVoiceMatches &&
          state.toolsDisabled &&
          state.toolChoiceNone;
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
        const status = event.response?.status;
        state.responseDoneCompleted = status === 'completed';
        state.responseDoneCancelled = status === 'cancelled';
        state.responseDoneFailed = status === 'failed';
        state.responseDoneIncomplete = status === 'incomplete';
        state.responseLimitReached =
          event.response?.status_details?.reason === 'max_output_tokens';
        if (!state.responseDoneCompleted) {
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
    diagnostics() {
      return {
        connected: state.connected,
        providerConfigurationObserved: state.providerConfigurationObserved,
        remoteAudioTrackReceived: state.remoteAudioTrackReceived,
        remoteAudioObserved: state.remoteAudioObserved,
        inputFinished: state.inputFinished,
        postInputLearnerTranscript: state.postInputLearnerTranscript,
        postInputCoachTranscript: state.postInputCoachTranscript,
        postInputResponseCompleted: state.postInputResponseCompleted,
        learnerTranscriptFinalCount: state.learnerTranscripts.length,
        coachTranscriptFinalCount: state.coachTranscripts.length,
        responseCompletedCount: state.responseCompletedCount,
        receivedEventCount: state.receivedEventCount,
        sessionCreatedObserved: state.sessionCreatedObserved,
        sessionModelMatches: state.sessionModelMatches,
        sessionVoiceMatches: state.sessionVoiceMatches,
        transcriptionConfigured: state.transcriptionConfigured,
        transcriptionModelMatches: state.transcriptionModelMatches,
        toolsDisabled: state.toolsDisabled,
        toolChoiceNone: state.toolChoiceNone,
        turnDetectionDisabled: state.turnDetectionDisabled,
        responseDoneCompleted: state.responseDoneCompleted,
        responseDoneCancelled: state.responseDoneCancelled,
        responseDoneFailed: state.responseDoneFailed,
        responseDoneIncomplete: state.responseDoneIncomplete,
        responseLimitReached: state.responseLimitReached,
      };
    },
  };
}
