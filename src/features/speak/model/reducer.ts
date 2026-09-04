import type {
  VoiceSessionEvent,
  VoiceSessionLifecycle,
  VoiceTurnState,
} from './voice-session';

export type VoiceSessionState = {
  lifecycle: VoiceSessionLifecycle;
  turn: VoiceTurnState;
  muted: boolean;
  captionsEnabled: boolean;
  events: VoiceSessionEvent[];
  lastSequence: number;
  failureCode: string | null;
};

export type VoiceSessionAction =
  | { type: 'admitted' }
  | { type: 'connected' }
  | { type: 'connection-lost' }
  | { type: 'reconnect-started' }
  | { type: 'end-requested' }
  | { type: 'ended' }
  | { type: 'failed'; code: string }
  | { type: 'muted'; muted: boolean }
  | { type: 'captions'; enabled: boolean }
  | { type: 'provider-event'; event: VoiceSessionEvent };

export function initialVoiceSessionState(captionsEnabled = true): VoiceSessionState {
  return {
    lifecycle: 'creating',
    turn: 'ready',
    muted: true,
    captionsEnabled,
    events: [],
    lastSequence: 0,
    failureCode: null,
  };
}

const TRANSITIONS: Record<VoiceSessionLifecycle, ReadonlySet<VoiceSessionLifecycle>> = {
  creating: new Set(['connecting', 'ending', 'failed']),
  connecting: new Set(['active', 'reconnecting', 'ending', 'failed']),
  active: new Set(['reconnecting', 'ending', 'failed']),
  reconnecting: new Set(['active', 'ending', 'failed']),
  ending: new Set(['ended', 'failed']),
  ended: new Set(),
  failed: new Set(),
};

function transition(state: VoiceSessionState, lifecycle: VoiceSessionLifecycle): VoiceSessionState {
  if (!TRANSITIONS[state.lifecycle].has(lifecycle)) return state;
  return { ...state, lifecycle, turn: lifecycle === 'active' ? state.turn : 'ready' };
}

export function voiceSessionReducer(
  state: VoiceSessionState,
  action: VoiceSessionAction,
): VoiceSessionState {
  switch (action.type) {
    case 'admitted':
      return transition(state, 'connecting');
    case 'connected':
      return transition(state, 'active');
    case 'connection-lost': {
      const reconnecting = transition(state, 'reconnecting');
      return reconnecting === state ? state : { ...reconnecting, muted: true };
    }
    case 'reconnect-started':
      return transition(state, 'reconnecting');
    case 'end-requested':
      return transition(state, 'ending');
    case 'ended':
      return transition(state, 'ended');
    case 'failed': {
      const failed = transition(state, 'failed');
      return failed === state ? state : { ...failed, failureCode: action.code };
    }
    case 'muted':
      if (state.lifecycle === 'ended' || state.lifecycle === 'failed') return state;
      return {
        ...state,
        muted: action.muted,
        turn:
          state.lifecycle !== 'active'
            ? state.turn
            : action.muted && state.turn === 'listening'
              ? 'thinking'
              : !action.muted
                ? 'listening'
                : state.turn,
      };
    case 'captions':
      return { ...state, captionsEnabled: action.enabled };
    case 'provider-event': {
      const event = action.event;
      if (
        state.lifecycle !== 'active' ||
        event.sequence <= state.lastSequence ||
        state.events.some((item) => item.event_id === event.event_id)
      ) {
        return state;
      }
      let turn = state.turn;
      if (event.type === 'transcript.partial') turn = 'listening';
      if (event.type === 'transcript.final') turn = 'thinking';
      if (event.type === 'response.started') turn = 'thinking';
      if (event.type === 'audio.started') turn = 'speaking';
      if (event.type === 'audio.stopped' || event.type === 'response.completed') turn = 'ready';
      if (event.type === 'response.interrupted') turn = 'interrupted';
      if (event.type === 'session.failed') {
        return {
          ...state,
          lifecycle: 'failed',
          turn: 'ready',
          muted: true,
          events: [...state.events, event],
          lastSequence: event.sequence,
          failureCode: 'provider_failed',
        };
      }
      return {
        ...state,
        events: [...state.events, event],
        lastSequence: event.sequence,
        turn,
      };
    }
  }
}
