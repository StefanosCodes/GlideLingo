import { createContext, useContext } from 'react';

import type { DesktopUpdateContextValue } from './types';

export const DesktopUpdateContext = createContext<DesktopUpdateContextValue | null>(null);

export function useDesktopUpdate() {
  return useContext(DesktopUpdateContext);
}
