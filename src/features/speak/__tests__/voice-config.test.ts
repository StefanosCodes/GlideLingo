import { expect, test } from '@jest/globals';

import { isVoiceEnabled } from '../voice-config';

test('voice remains disabled unless the client flag is explicitly true', () => {
  const previous = process.env.EXPO_PUBLIC_VOICE_ENABLED;
  delete process.env.EXPO_PUBLIC_VOICE_ENABLED;
  expect(isVoiceEnabled()).toBe(false);

  process.env.EXPO_PUBLIC_VOICE_ENABLED = 'true';
  expect(isVoiceEnabled()).toBe(true);

  if (previous === undefined) delete process.env.EXPO_PUBLIC_VOICE_ENABLED;
  else process.env.EXPO_PUBLIC_VOICE_ENABLED = previous;
});
