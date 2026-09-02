import { SignIn as ElectronSignIn } from '@clerk/electron/react';
import { SignIn as ReactSignIn } from '@clerk/react';
import type { ComponentProps } from 'react';

import { hasElectronClerkBridge } from './electron-bridge';

export function GlideLingoSignIn(props: ComponentProps<typeof ReactSignIn>) {
  const SignIn = hasElectronClerkBridge() ? ElectronSignIn : ReactSignIn;
  return <SignIn {...props} />;
}
