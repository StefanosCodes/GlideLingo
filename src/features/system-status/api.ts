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

function parseSystemReadyResponse(value: unknown): SystemReadyResponse | null {
  if (!isRecord(value) || value.status !== 'ready' || value.service !== 'glidelingo-api') return null;
  if (!isRecord(value.checks) || value.checks.database !== 'ok') return null;

  return {
    checks: { database: 'ok' },
    service: 'glidelingo-api',
    status: 'ready',
  };
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
