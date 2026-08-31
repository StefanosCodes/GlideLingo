import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

type AppThemeContextValue = {
  preference: ThemePreference;
  scheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = 'glidelingo-theme';
const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function getInitialPreference(): ThemePreference {
  if (Platform.OS !== 'web') return 'system';

  try {
    const storedPreference = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return isThemePreference(storedPreference) ? storedPreference : 'system';
  } catch {
    return 'system';
  }
}

export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, preference);
    } catch {
      // Theme switching still works for the current session without persistence.
    }
  }, [preference]);

  const scheme: ResolvedTheme = preference === 'system'
    ? systemScheme === 'dark' ? 'dark' : 'light'
    : preference;

  const value = useMemo<AppThemeContextValue>(() => ({
    preference,
    scheme,
    setPreference,
    toggleTheme: () => setPreference(scheme === 'dark' ? 'light' : 'dark'),
  }), [preference, scheme]);

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useThemeController() {
  const context = useContext(AppThemeContext);
  if (!context) throw new Error('useThemeController must be used within AppThemeProvider');
  return context;
}

export function useAppTheme() {
  const { scheme } = useThemeController();
  return Colors[scheme];
}
