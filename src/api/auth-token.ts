export type ApiAccessTokenProvider = () => Promise<string | null>;

let apiAccessTokenProvider: ApiAccessTokenProvider | null = null;

/**
 * Connect the singleton app API client to the current Clerk session.
 * The returned cleanup only clears the provider it installed, which keeps
 * React effect replacement safe during session changes.
 */
export function setApiAccessTokenProvider(provider: ApiAccessTokenProvider) {
  apiAccessTokenProvider = provider;
  return () => {
    if (apiAccessTokenProvider === provider) apiAccessTokenProvider = null;
  };
}

export async function getApiAuthorizationHeader(): Promise<Record<string, string>> {
  const accessToken = await apiAccessTokenProvider?.();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
