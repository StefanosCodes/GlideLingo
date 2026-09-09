import { Redirect, useLocalSearchParams } from 'expo-router';

type LegacyRedirectProps = {
  pathname: '/course' | '/practice';
  mode?: 'letters' | 'phrases' | 'review';
};

export function LegacyRedirect({ pathname, mode }: LegacyRedirectProps) {
  const searchParams = useLocalSearchParams<Record<string, string | string[]>>();

  return (
    <Redirect
      href={{
        pathname,
        params: mode ? { ...searchParams, mode } : searchParams,
      }}
    />
  );
}
