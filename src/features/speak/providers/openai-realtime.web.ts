import type {
  ConnectRealtimeOptions,
  PreparedRealtimeConnection,
  RealtimeTransport,
} from './openai-realtime.types';

export async function requestMicrophone(): Promise<MediaStream> {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is unavailable on this device.');
  }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

export async function connectOpenAIRealtime({
  admission,
  prepared,
  onConnected,
  onConnectionLost,
  onEvent,
}: ConnectRealtimeOptions): Promise<RealtimeTransport> {
  const { dataChannel, microphoneStream, peer } = prepared;
  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.setAttribute('aria-hidden', 'true');
  peer.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void remoteAudio.play().catch(() => undefined);
  };

  dataChannel.addEventListener('open', onConnected, { once: true });
  dataChannel.addEventListener('message', (event) => {
    try {
      onEvent(JSON.parse(String(event.data)) as unknown);
    } catch {
      onEvent(null);
    }
  });
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      onConnectionLost();
    }
  });

  try {
    await peer.setRemoteDescription({
      type: 'answer',
      sdp: admission.connection.answer_sdp,
    });
  } catch (error) {
    dataChannel.close();
    peer.close();
    microphoneStream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  let closed = false;
  return {
    admission,
    close() {
      if (closed) return;
      closed = true;
      dataChannel.close();
      peer.close();
      microphoneStream.getTracks().forEach((track) => track.stop());
      remoteAudio.pause();
      remoteAudio.srcObject = null;
    },
    interrupt() {
      if (closed || dataChannel.readyState !== 'open') return false;
      dataChannel.send(JSON.stringify({ type: 'response.cancel' }));
      dataChannel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
      return true;
    },
    setMuted(muted: boolean) {
      microphoneStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
  };
}

export async function prepareOpenAIRealtime(
  microphoneStream: MediaStream,
): Promise<PreparedRealtimeConnection> {
  const peer = new RTCPeerConnection();
  const track = microphoneStream.getAudioTracks()[0];
  if (!track) {
    peer.close();
    microphoneStream.getTracks().forEach((item) => item.stop());
    throw new Error('No microphone audio track was available.');
  }
  // The V1 contract is push-to-talk/turn-based: never transmit before an explicit unmute.
  track.enabled = false;
  peer.addTrack(track, microphoneStream);
  const dataChannel = peer.createDataChannel('oai-events');
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (!offer.sdp) throw new Error('The realtime connection offer was empty.');
    return { dataChannel, microphoneStream, offerSdp: offer.sdp, peer };
  } catch (error) {
    dataChannel.close();
    peer.close();
    microphoneStream.getTracks().forEach((item) => item.stop());
    throw error;
  }
}
