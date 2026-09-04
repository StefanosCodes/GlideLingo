export function isHumanTutorMarketplaceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED === 'true';
}
