import { safeAuthErrorMessage } from './credential-auth';

export function authErrorMessage(error: unknown, fallback: string) {
  return safeAuthErrorMessage(error, fallback);
}
