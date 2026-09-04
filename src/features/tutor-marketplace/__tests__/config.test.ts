import { afterEach, describe, expect, test } from '@jest/globals';

import { isHumanTutorGoogleCalendarEnabled, isHumanTutorMarketplaceEnabled } from '@/features/tutor-marketplace/config';

const previousValue = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
const previousCalendar = process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;

afterEach(() => {
  if (previousValue === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previousValue;
  if (previousCalendar === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED = previousCalendar;
});

describe('isHumanTutorGoogleCalendarEnabled', () => {
  test('is separately disabled by default and requires exact opt-in', () => {
    delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;
    expect(isHumanTutorGoogleCalendarEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED = 'true';
    expect(isHumanTutorGoogleCalendarEnabled()).toBe(true);
  });
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
