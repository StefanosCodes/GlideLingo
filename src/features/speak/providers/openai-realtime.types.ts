import type { VoiceSessionAdmission } from '../model/voice-session';

export type RawRealtimeEventHandler = (event: unknown) => void;

export type RealtimeTransport = {
  admission: VoiceSessionAdmission;
  close: () => void;
  interrupt: () => boolean;
  setMuted: (muted: boolean) => void;
};

export type PreparedRealtimeConnection = {
  dataChannel: RTCDataChannel;
  microphoneStream: MediaStream;
  offerSdp: string;
  peer: RTCPeerConnection;
};

export type ConnectRealtimeOptions = {
  admission: VoiceSessionAdmission;
  prepared: PreparedRealtimeConnection;
  onConnected: () => void;
  onConnectionLost: () => void;
  onEvent: RawRealtimeEventHandler;
};
