export function isHumanTutorMarketplaceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED === 'true';
}

export function isHumanTutorGoogleCalendarEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED === 'true';
}
