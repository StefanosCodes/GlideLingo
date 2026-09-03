import { ClerkProvider as ElectronClerkProvider } from '@clerk/electron/react';
import { ClerkProvider as ReactClerkProvider } from '@clerk/react';
import { router } from 'expo-router';
import type { PropsWithChildren } from 'react';

import {
  ALLOWED_AUTH_REDIRECT_PROTOCOLS,
  CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS,
} from '@/features/auth/oauth-flow';

import { shouldUseElectronClerkNativeAuth } from './electron-bridge';

type GlideLingoClerkProviderProps = PropsWithChildren<{
  publishableKey: string;
}>;

export function GlideLingoClerkProvider({
  children,
  publishableKey,
}: GlideLingoClerkProviderProps) {
  const navigateWithExpoRouter = (to: string) => {
    if (/^https?:\/\//.test(to)) {
      window.location.assign(to);
      return;
    }

    router.push(to as never);
  };
  const replaceWithExpoRouter = (to: string) => {
    if (/^https?:\/\//.test(to)) {
      window.location.replace(to);
      return;
    }

    router.replace(to as never);
  };

  if (shouldUseElectronClerkNativeAuth()) {
    return (
      <ElectronClerkProvider
        allowedRedirectOrigins={CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS}
        allowedRedirectProtocols={ALLOWED_AUTH_REDIRECT_PROTOCOLS}
        publishableKey={publishableKey}
        routerPush={navigateWithExpoRouter}
        routerReplace={replaceWithExpoRouter}>
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
