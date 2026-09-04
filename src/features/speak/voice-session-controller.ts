import {
  createVoiceSession,
  endVoiceSession,
  reconnectVoiceSession,
  type StartVoiceSession,
  VoiceSessionRequestError,
} from './api/voice-sessions';
import {
  initialVoiceSessionState,
  voiceSessionReducer,
  type VoiceSessionAction,
  type VoiceSessionState,
} from './model/reducer';
import type { VoiceSessionAdmission, VoiceSessionEvent, VoiceSessionRecap } from './model/voice-session';
import { connectOpenAIRealtime, prepareOpenAIRealtime, requestMicrophone } from './providers/openai-realtime';
import type { PreparedRealtimeConnection, RealtimeTransport } from './providers/openai-realtime.types';
import { normalizeOpenAIRealtimeEvent } from './providers/normalize-openai-event';

type VoiceSessionControllerDependencies = {
  connect: typeof connectOpenAIRealtime;
  create: typeof createVoiceSession;
  end: typeof endVoiceSession;
  prepare: typeof prepareOpenAIRealtime;
  reconnect: typeof reconnectVoiceSession;
  requestMicrophone: typeof requestMicrophone;
};

const DEFAULT_DEPENDENCIES: VoiceSessionControllerDependencies = {
  connect: connectOpenAIRealtime,
  create: createVoiceSession,
  end: endVoiceSession,
  prepare: prepareOpenAIRealtime,
  reconnect: reconnectVoiceSession,
  requestMicrophone,
};

const DEFAULT_CONNECTION_DEADLINE_MS = 20_000;
const MAX_PROVIDER_EVENT_SEQUENCE = 10_000;

export class VoiceSessionController {
  private admission: VoiceSessionAdmission | null = null;
  private dependencies: VoiceSessionControllerDependencies;
  private generation = 0;
  private pendingAbort: AbortController | null = null;
  private pendingPrepared: PreparedRealtimeConnection | null = null;
  private pendingStream: MediaStream | null = null;
  private receivedEventCount = 0;
  private sequence = 0;
  private state: VoiceSessionState;
  private transport: RealtimeTransport | null = null;

  constructor(
    private readonly onState: (state: VoiceSessionState) => void,
    captionsEnabled = true,
    dependencies: VoiceSessionControllerDependencies = DEFAULT_DEPENDENCIES,
    private readonly connectionDeadlineMs = DEFAULT_CONNECTION_DEADLINE_MS,
  ) {
    this.state = initialVoiceSessionState(captionsEnabled);
    this.dependencies = dependencies;
  }

  get snapshot(): VoiceSessionState {
    return this.state;
  }

  async start(request: Omit<StartVoiceSession, 'offer_sdp'>): Promise<VoiceSessionAdmission> {
    const generation = ++this.generation;
    const deadlineAt = Date.now() + this.connectionDeadlineMs;
    const abort = new AbortController();
    this.pendingAbort = abort;
    let admission: VoiceSessionAdmission | null = null;
    let prepared: PreparedRealtimeConnection | null = null;
    try {
      const stream = await withinDeadline(
        this.dependencies.requestMicrophone(),
        deadlineAt,
        stopStream,
      );
      this.pendingStream = stream;
      if (generation !== this.generation) throw new Error('Voice start was cancelled.');
      prepared = await withinDeadline(this.dependencies.prepare(stream), deadlineAt, discardPrepared);
      this.pendingStream = null;
      this.pendingPrepared = prepared;
      if (generation !== this.generation) throw new Error('Voice start was cancelled.');
      const startRequest = { ...request, offer_sdp: prepared.offerSdp };
      const idempotencyKey = makeIdempotencyKey('voice-start');
      admission = await withinDeadline(
        retryAmbiguousRequest(
          () => this.dependencies.create(startRequest, idempotencyKey, abort.signal),
          abort.signal,
        ),
        deadlineAt,
        (lateAdmission) => void this.stopAdmission(lateAdmission, 'failed'),
      );
      if (generation !== this.generation) throw new Error('Voice start was superseded.');
      this.admission = admission;
      this.dispatch({ type: 'admitted' });
      const transport = await withinDeadline(
        this.attach(admission, prepared, generation),
        deadlineAt,
        (lateTransport) => lateTransport.close(),
      );
      if (generation !== this.generation) {
        transport.close();
        if (this.transport === transport) this.transport = null;
        throw new Error('Voice start was superseded.');
      }
      this.pendingPrepared = null;
      this.pendingAbort = null;
      return admission;
    } catch (error) {
      abort.abort();
      this.discardPending(prepared);
      if (admission !== null) await this.stopAdmission(admission, 'failed');
      if (generation === this.generation) {
        this.pendingAbort = null;
        this.dispatch({ type: 'failed', code: 'start_failed' });
      }
      throw error;
    }
  }

  async reconnect(): Promise<void> {
    const admission = this.admission;
    if (!admission || this.state.lifecycle !== 'reconnecting') return;
    const generation = ++this.generation;
    const deadlineAt = Date.now() + this.connectionDeadlineMs;
    const abort = new AbortController();
    this.pendingAbort = abort;
    this.transport?.close();
    this.transport = null;
    let replacementAdmission: VoiceSessionAdmission | null = null;
    let prepared: PreparedRealtimeConnection | null = null;
    try {
      const stream = await withinDeadline(
        this.dependencies.requestMicrophone(),
        deadlineAt,
        stopStream,
      );
      this.pendingStream = stream;
      if (generation !== this.generation) throw new Error('Voice reconnect was cancelled.');
      prepared = await withinDeadline(this.dependencies.prepare(stream), deadlineAt, discardPrepared);
      this.pendingStream = null;
      this.pendingPrepared = prepared;
      const replacementPrepared = prepared;
      const idempotencyKey = makeIdempotencyKey('voice-reconnect');
      replacementAdmission = await withinDeadline(
        retryAmbiguousRequest(
          () =>
            this.dependencies.reconnect(
              admission.session_id,
              replacementPrepared.offerSdp,
              idempotencyKey,
              abort.signal,
            ),
          abort.signal,
        ),
        deadlineAt,
        (lateAdmission) => void this.stopAdmission(lateAdmission, 'failed'),
      );
      const replacement = replacementAdmission;
      if (generation !== this.generation) throw new Error('Voice reconnect was superseded.');
      this.admission = replacement;
      const transport = await withinDeadline(
        this.attach(replacement, replacementPrepared, generation),
        deadlineAt,
        (lateTransport) => lateTransport.close(),
      );
      if (generation !== this.generation) {
        transport.close();
        if (this.transport === transport) this.transport = null;
        throw new Error('Voice reconnect was superseded.');
      }
      this.pendingPrepared = null;
      this.pendingAbort = null;
    } catch (error) {
      abort.abort();
      this.discardPending(prepared);
      if (replacementAdmission !== null) {
        await this.stopAdmission(replacementAdmission, 'failed');
      }
      if (generation === this.generation) {
        this.pendingAbort = null;
        this.dispatch({ type: 'failed', code: 'reconnect_failed' });
      }
      throw error;
    }
  }

  setMuted(muted: boolean): void {
    this.transport?.setMuted(muted);
    this.dispatch({ type: 'muted', muted });
  }

  setCaptionsEnabled(enabled: boolean): void {
    this.dispatch({ type: 'captions', enabled });
  }

  interrupt(): boolean {
    if (!this.transport?.interrupt() || !this.admission) return false;
    this.dispatch({
      type: 'provider-event',
      event: {
        event_id: `client:interrupt:${++this.sequence}`,
        session_id: this.admission.session_id,
        sequence: this.sequence,
        occurred_at: new Date().toISOString(),
        type: 'response.interrupted',
      },
    });
    return true;
  }

  async end(reason: VoiceSessionRecap['end_reason'] = 'cancelled'): Promise<VoiceSessionRecap | null> {
    const admission = this.admission;
    if (this.state.lifecycle === 'ended') return null;
    ++this.generation;
    this.pendingAbort?.abort();
    this.pendingAbort = null;
    this.discardPending(this.pendingPrepared);
    this.dispatch({ type: 'end-requested' });
    this.transport?.close();
    this.transport = null;
    if (!admission) {
      this.dispatch({ type: 'ended' });
      return null;
    }
    try {
      const recap = await this.dependencies.end(
        admission.session_id,
        { reason, events: transcriptEvents(this.state.events) },
        makeIdempotencyKey('voice-end'),
      );
      this.dispatch({ type: 'ended' });
      return recap;
    } catch (error) {
      this.dispatch({ type: 'failed', code: 'cleanup_unconfirmed' });
      throw error;
    }
  }

  private async attach(
    admission: VoiceSessionAdmission,
    prepared: PreparedRealtimeConnection,
    generation: number,
  ): Promise<RealtimeTransport> {
    const transport = await this.dependencies.connect({
      admission,
      prepared,
      onConnected: () => {
        if (this.generation === generation) this.dispatch({ type: 'connected' });
      },
      onConnectionLost: () => {
        if (this.generation === generation) {
          ++this.generation;
          const disconnected = this.transport;
          this.transport = null;
          disconnected?.setMuted(true, false);
          disconnected?.close();
          this.dispatch({ type: 'connection-lost' });
        }
      },
      onEvent: (raw) => {
        if (this.generation !== generation) return;
        this.receivedEventCount += 1;
        if (this.receivedEventCount > MAX_PROVIDER_EVENT_SEQUENCE) {
          ++this.generation;
          this.transport?.setMuted(true, false);
          this.transport?.close();
          this.transport = null;
          this.dispatch({ type: 'failed', code: 'provider_event_limit' });
          void this.stopAdmission(admission, 'failed');
          return;
        }
        const event = normalizeOpenAIRealtimeEvent(raw, {
          sessionId: admission.session_id,
          sequence: this.sequence + 1,
        });
        if (!event) return;
        this.sequence += 1;
        this.dispatch({ type: 'provider-event', event });
        if (event.type === 'session.failed') {
          ++this.generation;
          this.transport?.setMuted(true, false);
          this.transport?.close();
          this.transport = null;
          void this.stopAdmission(admission, 'failed');
        }
      },
    });
    this.transport = transport;
    return transport;
  }

  private dispatch(action: VoiceSessionAction): void {
    this.state = voiceSessionReducer(this.state, action);
    this.onState(this.state);
  }

  private discardPending(prepared: PreparedRealtimeConnection | null): void {
    if (prepared !== null && this.pendingPrepared === prepared) {
      discardPrepared(prepared);
      this.pendingPrepared = null;
    }
    if (this.pendingStream !== null) {
      this.pendingStream.getTracks().forEach((track) => track.stop());
      this.pendingStream = null;
    }
  }

  private async stopAdmission(
    admission: VoiceSessionAdmission,
    reason: VoiceSessionRecap['end_reason'],
  ): Promise<void> {
    try {
      await this.dependencies.end(
        admission.session_id,
        { reason, events: transcriptEvents(this.state.events) },
        makeIdempotencyKey('voice-cleanup'),
      );
    } catch {
      // The server-owned expiry path remains the final cleanup backstop.
    }
  }
}

function discardPrepared(prepared: PreparedRealtimeConnection): void {
  prepared.dataChannel.close();
  prepared.peer.close();
  prepared.microphoneStream.getTracks().forEach((track) => track.stop());
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

function makeIdempotencyKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}

export function transcriptEvents(events: VoiceSessionEvent[]): VoiceSessionEvent[] {
  return events.filter((event) => event.type === 'transcript.final').slice(-256);
}

async function retryAmbiguousRequest<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      signal.aborted ||
      !(error instanceof VoiceSessionRequestError) ||
      error.cancelled ||
      !error.retryable
    ) {
      throw error;
    }
    return operation();
  }
}

async function withinDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
  disposeLateValue: (value: T) => void,
): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    void operation.then(disposeLateValue, () => undefined);
    throw new Error('The voice connection deadline elapsed.');
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      settled = true;
      reject(new Error('The voice connection deadline elapsed.'));
    }, remaining);
    void operation.then(
      (value) => {
        if (settled) {
          disposeLateValue(value);
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
