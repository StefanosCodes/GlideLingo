import { afterEach, describe, expect, test } from '@jest/globals';

import { isHumanTutorMarketplaceEnabled } from '@/features/tutor-marketplace/config';

const previousValue = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;

afterEach(() => {
  if (previousValue === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previousValue;
});

describe('isHumanTutorMarketplaceEnabled', () => {
  test.each([undefined, '', 'TRUE', '1', 'yes'])('fails closed for %p', (value) => {
    if (value === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
    else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = value;
    expect(isHumanTutorMarketplaceEnabled()).toBe(false);
  });

  test('enables only for the exact explicit value', () => {
    process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
    expect(isHumanTutorMarketplaceEnabled()).toBe(true);
  });
});
