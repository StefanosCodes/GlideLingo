export function isHumanTutorMarketplaceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED === 'true';
}

export function isHumanTutorMarketplaceAcquisitionEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED === 'true';
}

export function isHumanTutorGoogleCalendarEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED === 'true';
}

export function isHumanTutorMessagingEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED === 'true';
}

export function isHumanTutorCommerceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED === 'true';
}

export function isHumanTutorLearningBridgeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED === 'true';
}
