import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import type { PropsWithChildren } from 'react';

type GlideLingoClerkProviderProps = PropsWithChildren<{
  publishableKey: string;
}>;

export function GlideLingoClerkProvider({
  children,
  publishableKey,
}: GlideLingoClerkProviderProps) {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {children}
    </ClerkProvider>
  );
}
