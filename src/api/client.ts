import {
  ApiConfigurationError,
  resolveApiRuntimeConfiguration,
  type ApiRuntimeConfiguration,
} from '@/config/api';

const DEFAULT_TIMEOUT_MS = 9_000;

export type ApiClientErrorKind =
  | 'configuration'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid-response';

export type ApiClientRuntimeDetails = {
  origin: string | null;
  platform: ApiRuntimeConfiguration['platform'];
  source: ApiRuntimeConfiguration['source'] | 'invalid';
};

type ApiClientErrorOptions = {
  body?: unknown;
  requestId?: string | null;
  runtime: ApiClientRuntimeDetails;
  status?: number;
};

export class ApiClientError extends Error {
  readonly body: unknown;
  readonly kind: ApiClientErrorKind;
  readonly requestId: string | null;
  readonly runtime: ApiClientRuntimeDetails;
  readonly status: number | null;

  constructor(kind: ApiClientErrorKind, message: string, options: ApiClientErrorOptions) {
    super(message);
    this.name = 'ApiClientError';
    this.body = options.body;
    this.kind = kind;
    this.requestId = options.requestId ?? null;
    this.runtime = options.runtime;
    this.status = options.status ?? null;
  }
}

export type ApiJsonResponse<T> = {
  data: T;
  requestId: string | null;
  runtime: ApiClientRuntimeDetails;
  status: number;
};

type GetJsonOptions<T> = {
  parse: (value: unknown) => T | null;
  path: `/${string}`;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export function getApiClientRuntimeDetails(): ApiClientRuntimeDetails {
  try {
    const configuration = resolveApiRuntimeConfiguration();
    return configuration;
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      return { origin: null, platform: error.platform, source: 'invalid' };
    }
    throw error;
  }
}

export async function getJson<T>({
  parse,
  path,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GetJsonOptions<T>): Promise<ApiJsonResponse<T>> {
  const configuration = resolveConfigurationForRequest();
  const runtime: ApiClientRuntimeDetails = configuration;
  const requestUrl = composeRequestUrl(configuration.origin, path, runtime);
  const controller = new AbortController();
  let cancelledExternally = signal?.aborted ?? false;
  let timedOut = false;

  const handleExternalAbort = () => {
    cancelledExternally = true;
    controller.abort();
  };

  if (cancelledExternally) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', handleExternalAbort, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(requestUrl, {
      headers: { Accept: 'application/json' },
      method: 'GET',
      signal: controller.signal,
    });
    const requestId = response.headers.get('x-request-id');
    const jsonBody = await readJsonBody(response);

    if (!response.ok) {
      throw new ApiClientError('http', `The API responded with status ${response.status}.`, {
        body: jsonBody.ok ? jsonBody.value : undefined,
        requestId,
        runtime,
        status: response.status,
      });
    }

    if (!jsonBody.ok) {
      throw new ApiClientError('invalid-response', 'The API response was not valid JSON.', {
        requestId,
        runtime,
        status: response.status,
      });
    }

    const data = parse(jsonBody.value);
    if (data === null) {
      throw new ApiClientError('invalid-response', 'The API response did not match the expected contract.', {
        requestId,
        runtime,
        status: response.status,
      });
    }

    return { data, requestId, runtime, status: response.status };
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (cancelledExternally) {
      throw new ApiClientError('cancelled', 'The API request was cancelled.', { runtime });
    }
    if (timedOut) {
      throw new ApiClientError('timeout', 'The API request timed out.', { runtime });
    }
    throw new ApiClientError('network', 'The API could not be reached.', { runtime });
  } finally {
    clearTimeout(timeoutHandle);
    signal?.removeEventListener('abort', handleExternalAbort);
  }
}

function resolveConfigurationForRequest(): ApiRuntimeConfiguration {
  try {
    return resolveApiRuntimeConfiguration();
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      throw new ApiClientError('configuration', 'The API base URL is not configured correctly.', {
        runtime: { origin: null, platform: error.platform, source: 'invalid' },
      });
    }
    throw error;
  }
}

function composeRequestUrl(origin: string, path: `/${string}`, runtime: ApiClientRuntimeDetails): string {
  const unsafePath =
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#') ||
    path.split('/').some((segment) => segment === '.' || segment === '..');

  if (unsafePath) {
    throw new ApiClientError('configuration', 'The API request path is not valid.', { runtime });
  }

  const baseUrl = new URL(`${origin.replace(/\/+$/, '')}/`);
  const requestUrl = new URL(path.slice(1), baseUrl);

  if (requestUrl.origin !== baseUrl.origin) {
    throw new ApiClientError('configuration', 'The API request path is not valid.', { runtime });
  }

  return requestUrl.toString();
}

async function readJsonBody(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const responseText = await response.text();
  if (!responseText) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(responseText) as unknown };
  } catch {
    return { ok: false };
  }
}
