import { connectOpenAIRealtime, prepareOpenAIRealtime } from '/openai-realtime.web.js';
import { createEvidenceTracker } from '/evidence.mjs';

const startedAt = Date.now();
const harnessToken = new URL(location.href).searchParams.get('token');
if (!harnessToken) throw new Error('Missing harness token.');
const harnessHeaders = {
  'content-type': 'application/json',
  'x-voice-harness-token': harnessToken,
};
const evidence = createEvidenceTracker({ model: 'gpt-realtime-2.1', voice: 'marin' });
let transport = null;
let sessionId = null;
let audioContext = null;
let peer = null;

try {
  audioContext = new AudioContext();
  await audioContext.resume();
  const audioBytes = await (await fetch('/fixture.mp3', { cache: 'no-store' })).arrayBuffer();
  const buffer = await audioContext.decodeAudioData(audioBytes);
  const source = audioContext.createBufferSource();
  const microphone = audioContext.createMediaStreamDestination();
  source.buffer = buffer;
  source.connect(microphone);
  const prepared = await prepareOpenAIRealtime(microphone.stream);
  peer = prepared.peer;
  let remoteAudioObserved = false;
  prepared.peer.addEventListener('track', (event) => {
    if (event.track.kind !== 'audio') return;
    evidence.markRemoteAudioTrack();
    const stream = event.streams[0] || new MediaStream([event.track]);
    const analyser = audioContext.createAnalyser();
    const remoteSource = audioContext.createMediaStreamSource(stream);
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    remoteSource.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    const samples = new Uint8Array(analyser.fftSize);
    const sample = () => {
      if (event.track.readyState === 'ended' || remoteAudioObserved) return;
      analyser.getByteTimeDomainData(samples);
      remoteAudioObserved = samples.some((value) => Math.abs(value - 128) > 2);
      if (remoteAudioObserved) evidence.markRemoteAudio();
      requestAnimationFrame(sample);
    };
    sample();
  });
  const admissionResponse = await fetch('/session', {
    method: 'POST',
    headers: harnessHeaders,
    body: JSON.stringify({ offer_sdp: prepared.offerSdp }),
  });
  if (!admissionResponse.ok) throw new Error(`Admission failed with ${admissionResponse.status}.`);
  const admission = await admissionResponse.json();
  sessionId = admission.session_id;
  transport = await connectOpenAIRealtime({
    admission,
    prepared,
    onConnected: () => evidence.markConnected(),
    onConnectionLost: () => {},
    onEvent: (event) => evidence.observeEvent(event),
  });
  transport.setMuted(false);
  source.start();
  await new Promise((resolvePromise) => { source.onended = resolvePromise; });
  transport.setMuted(true);
  evidence.markInputFinished();
  await Promise.race([
    evidence.complete,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime evidence timed out.')), 30_000)),
  ]);
  const observed = evidence.snapshot();
  transport.close();
  transport = null;
  const ended = await fetch('/end', {
    method: 'POST',
    headers: harnessHeaders,
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!ended.ok) throw new Error(`Provider hangup failed with ${ended.status}.`);
  const recap = await ended.json();
  await fetch('/complete', {
    method: 'POST',
    headers: harnessHeaders,
    body: JSON.stringify({
      ...observed,
      interruptionSent: false,
      providerHangupConfirmed: recap.provider_hangup_confirmed === true,
      recapTranscriptCount: Array.isArray(recap.transcript) ? recap.transcript.length : -1,
      elapsedMs: Date.now() - startedAt,
    }),
  });
} catch (error) {
  const mediaEvidence = await outboundMediaEvidence(peer);
  transport?.close();
  if (sessionId) {
    await fetch('/end', {
      method: 'POST',
      headers: harnessHeaders,
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => undefined);
  }
  await fetch('/failed', {
    method: 'POST',
    headers: harnessHeaders,
    body: JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      evidence: { ...evidence.diagnostics(), ...mediaEvidence },
    }),
  }).catch(() => undefined);
} finally {
  await audioContext?.close().catch(() => undefined);
}

async function outboundMediaEvidence(activePeer) {
  if (!activePeer || activePeer.connectionState === 'closed') {
    return { outboundAudioBytes: 0, outboundAudioEnergyObserved: false };
  }
  try {
    const stats = await activePeer.getStats();
    let outboundAudioBytes = 0;
    let outboundAudioEnergyObserved = false;
    for (const report of stats.values()) {
      if (report.type === 'outbound-rtp' && report.kind === 'audio') {
        outboundAudioBytes += Number(report.bytesSent) || 0;
      }
      if (report.type === 'media-source' && report.kind === 'audio') {
        outboundAudioEnergyObserved = (Number(report.totalAudioEnergy) || 0) > 0;
      }
    }
    return { outboundAudioBytes, outboundAudioEnergyObserved };
  } catch {
    return { outboundAudioBytes: 0, outboundAudioEnergyObserved: false };
  }
}
