import { isClerkAPIResponseError } from '@/providers/clerk-errors';

export function authErrorMessage(error: unknown, fallback: string) {
  if (isClerkAPIResponseError(error)) {
    return error.errors[0]?.longMessage ?? error.errors[0]?.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}
