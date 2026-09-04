export function isVoiceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_VOICE_ENABLED === 'true';
}
