import { afterEach, describe, expect, test } from '@jest/globals';

import {
  isHumanTutorCommerceEnabled,
  isHumanTutorGoogleCalendarEnabled,
  isHumanTutorLearningBridgeEnabled,
  isHumanTutorMarketplaceAcquisitionEnabled,
  isHumanTutorMarketplaceEnabled,
} from '@/features/tutor-marketplace/config';

const previousValue = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
const previousCalendar = process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;
const previousCommerce = process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED;
const previousLearningBridge = process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED;
const previousAcquisition = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED;

afterEach(() => {
  if (previousValue === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previousValue;
  if (previousCalendar === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED = previousCalendar;
  if (previousCommerce === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED = previousCommerce;
  if (previousLearningBridge === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED = previousLearningBridge;
  if (previousAcquisition === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED = previousAcquisition;
});

describe('isHumanTutorMarketplaceAcquisitionEnabled', () => {
  test('is separately disabled by default and requires exact opt-in', () => {
    delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED;
    expect(isHumanTutorMarketplaceAcquisitionEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED = 'true';
    expect(isHumanTutorMarketplaceAcquisitionEnabled()).toBe(true);
  });
});

describe('isHumanTutorLearningBridgeEnabled', () => {
  test('is separately disabled by default and requires exact opt-in', () => {
    delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED;
    expect(isHumanTutorLearningBridgeEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED = 'true';
    expect(isHumanTutorLearningBridgeEnabled()).toBe(true);
  });
});

describe('isHumanTutorCommerceEnabled', () => {
  test('is separately disabled by default and requires exact opt-in', () => {
    delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED;
    expect(isHumanTutorCommerceEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED = 'true';
    expect(isHumanTutorCommerceEnabled()).toBe(true);
  });
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
