import { ClerkProvider as ElectronClerkProvider } from '@clerk/electron/react';
import { ClerkProvider as ReactClerkProvider } from '@clerk/react';
import type { PropsWithChildren } from 'react';

import {
  ALLOWED_AUTH_REDIRECT_PROTOCOLS,
  CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS,
} from '@/features/auth/oauth-flow';

import { hasElectronClerkBridge } from './electron-bridge';

type GlideLingoClerkProviderProps = PropsWithChildren<{
  publishableKey: string;
}>;

export function GlideLingoClerkProvider({
  children,
  publishableKey,
}: GlideLingoClerkProviderProps) {
  if (hasElectronClerkBridge()) {
    return (
      <ElectronClerkProvider
        allowedRedirectOrigins={CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS}
        allowedRedirectProtocols={ALLOWED_AUTH_REDIRECT_PROTOCOLS}
        publishableKey={publishableKey}>
        {children}
      </ElectronClerkProvider>
    );
  }

  return (
    <ReactClerkProvider publishableKey={publishableKey}>
      {children}
    </ReactClerkProvider>
  );
}
