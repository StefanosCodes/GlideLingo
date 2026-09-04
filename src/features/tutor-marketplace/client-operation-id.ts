import { randomUUID } from 'expo-crypto';

export function createMarketplaceClientId(): string {
  return randomUUID();
}
