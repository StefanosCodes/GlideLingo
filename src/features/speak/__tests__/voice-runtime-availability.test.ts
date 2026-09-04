import { expect, test } from '@jest/globals';

import { resolveVoiceRuntimeAvailability } from '../voice-runtime-availability';

test('enables the reviewed adapter only in an ordinary web browser', () => {
  expect(resolveVoiceRuntimeAvailability('web', false)).toBe('available');
  expect(resolveVoiceRuntimeAvailability('web', true)).toBe('desktop-unavailable');
  expect(resolveVoiceRuntimeAvailability('ios', false)).toBe('native-unavailable');
  expect(resolveVoiceRuntimeAvailability('android', false)).toBe('native-unavailable');
});
