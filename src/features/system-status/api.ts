import {
  ApiClientError,
  getApiClientRuntimeDetails,
  getJson,
  type ApiClientRuntimeDetails,
} from '@/api/client';

export type SystemReadyResponse = {
  checks: { database: 'ok' };
  service: 'glidelingo-api';
  status: 'ready';
};

export type SystemDependencyUnavailableResponse = {
  error: {
    code: 'dependency_unavailable';
    message: 'A required dependency is unavailable.';
    request_id: string;
  };
};

export type SystemStatusSuccess = {
  requestId: string | null;
  response: SystemReadyResponse;
  status: number;
};

export type AuthSessionResponse = {
  user_id: string;
};

export type AuthSessionProof = {
  matchesCurrentUser: boolean;
  requestId: string | null;
  status: number;
};

export type AuthSessionProofErrorKind =
  | 'unauthorized'
  | 'unavailable'
  | 'configuration'
  | 'cancelled';

export class AuthSessionProofError extends Error {
  readonly kind: AuthSessionProofErrorKind;
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(
    kind: AuthSessionProofErrorKind,
    options: { requestId?: string | null; status?: number | null } = {},
  ) {
    super('The authenticated API session proof did not complete successfully.');
    this.name = 'AuthSessionProofError';
    this.kind = kind;
    this.requestId = options.requestId ?? null;
    this.status = options.status ?? null;
  }
}

export type SystemStatusErrorKind = 'not-ready' | 'unreachable' | 'configuration' | 'cancelled';

type SystemStatusErrorOptions = {
  requestId?: string | null;
  status?: number | null;
};

export class SystemStatusError extends Error {
  readonly kind: SystemStatusErrorKind;
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(kind: SystemStatusErrorKind, options: SystemStatusErrorOptions = {}) {
    super('The system readiness check did not complete successfully.');
    this.name = 'SystemStatusError';
    this.kind = kind;
    this.requestId = options.requestId ?? null;
    this.status = options.status ?? null;
  }
}

export function getSystemStatusRuntimeDetails(): ApiClientRuntimeDetails {
  return getApiClientRuntimeDetails();
}

export async function getSystemStatus(signal?: AbortSignal): Promise<SystemStatusSuccess> {
  try {
    const result = await getJson({
      parse: parseSystemReadyResponse,
      path: '/health/ready',
      signal,
    });

    return {
      requestId: result.requestId,
      response: result.data,
      status: result.status,
    };
  } catch (error) {
    if (!(error instanceof ApiClientError)) {
      throw new SystemStatusError('unreachable');
    }

    if (error.kind === 'configuration') {
      throw new SystemStatusError('configuration');
    }
    if (error.kind === 'cancelled') {
      throw new SystemStatusError('cancelled');
    }
    if (error.kind === 'http' && error.status === 503) {
      const errorEnvelope = parseDependencyUnavailableResponse(error.body);
      if (!errorEnvelope) {
        throw new SystemStatusError('unreachable', {
          requestId: error.requestId,
          status: error.status,
        });
      }
      throw new SystemStatusError('not-ready', {
        requestId: error.requestId ?? errorEnvelope.error.request_id,
        status: error.status,
      });
    }

    throw new SystemStatusError('unreachable', {
      requestId: error.requestId,
      status: error.status,
    });
  }
}

export async function getAuthSessionProof(
  currentUserId: string,
  signal?: AbortSignal,
): Promise<AuthSessionProof> {
  if (!isBoundedIdentifier(currentUserId)) {
    throw new AuthSessionProofError('unavailable');
  }

  try {
    const result = await getJson({
      parse: parseAuthSessionResponse,
      path: '/v1/auth/session',
      signal,
    });

    return {
      matchesCurrentUser: result.data.user_id === currentUserId,
      requestId: result.requestId,
      status: result.status,
    };
  } catch (error) {
    if (!(error instanceof ApiClientError)) {
      throw new AuthSessionProofError('unavailable');
    }
    if (error.kind === 'configuration') {
      throw new AuthSessionProofError('configuration');
    }
    if (error.kind === 'cancelled') {
      throw new AuthSessionProofError('cancelled');
    }
    if (error.kind === 'http' && error.status === 401) {
      throw new AuthSessionProofError('unauthorized', {
        requestId: error.requestId,
        status: error.status,
      });
    }
    throw new AuthSessionProofError('unavailable', {
      requestId: error.requestId,
      status: error.status,
    });
  }
}

function parseSystemReadyResponse(value: unknown): SystemReadyResponse | null {
  if (!isRecord(value) || value.status !== 'ready' || value.service !== 'glidelingo-api') return null;
  if (!isRecord(value.checks) || value.checks.database !== 'ok') return null;

  return {
    checks: { database: 'ok' },
    service: 'glidelingo-api',
    status: 'ready',
  };
}

function parseAuthSessionResponse(value: unknown): AuthSessionResponse | null {
  if (!isRecord(value) || !isBoundedIdentifier(value.user_id)) return null;
  return { user_id: value.user_id };
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value === value.trim();
}

function parseDependencyUnavailableResponse(value: unknown): SystemDependencyUnavailableResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  if (
    value.error.code !== 'dependency_unavailable' ||
    value.error.message !== 'A required dependency is unavailable.' ||
    typeof value.error.request_id !== 'string' ||
    value.error.request_id.length === 0
  ) {
    return null;
  }

  return {
    error: {
      code: 'dependency_unavailable',
      message: 'A required dependency is unavailable.',
      request_id: value.error.request_id,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
