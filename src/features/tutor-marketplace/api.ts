import { ApiClientError, getJson, postJson } from '@/api/client';

export type TutorApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type TutorApplication = {
  applicationId: string;
  status: TutorApplicationStatus;
  version: number;
  headline: string;
  biography: string;
  timeZone: string;
  languages: string[];
  specialties: string[];
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
};

export type TutorApplicationDraft = {
  headline: string;
  biography: string;
  timeZone: string;
  languages: string[];
  specialties: string[];
};

export class TutorMarketplaceClientError extends Error {
  readonly kind: 'not-found' | 'forbidden' | 'conflict' | 'validation' | 'unavailable';

  constructor(kind: TutorMarketplaceClientError['kind']) {
    super('The tutor marketplace request did not complete successfully.');
    this.name = 'TutorMarketplaceClientError';
    this.kind = kind;
  }
}

export async function getOwnTutorApplication(signal?: AbortSignal): Promise<TutorApplication> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorApplication,
      path: '/v1/tutor-application',
      signal,
    });
    return result.data;
  });
}

export async function createTutorApplication(
  draft: TutorApplicationDraft,
  signal?: AbortSignal,
): Promise<TutorApplication> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        headline: draft.headline,
        biography: draft.biography,
        time_zone: draft.timeZone,
        languages: draft.languages,
        specialties: draft.specialties,
      },
      parse: parseTutorApplication,
      path: '/v1/tutor-applications',
      signal,
    });
    return result.data;
  });
}

export async function submitTutorApplication(
  expectedVersion: number,
  signal?: AbortSignal,
): Promise<TutorApplication> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { expected_version: expectedVersion },
      parse: parseTutorApplication,
      path: '/v1/tutor-application/submit',
      signal,
    });
    return result.data;
  });
}

export function parseTutorApplication(value: unknown): TutorApplication | null {
  if (!isRecord(value)) return null;
  if (
    !isUuid(value.application_id) ||
    !isApplicationStatus(value.status) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !isBoundedString(value.headline, 80) ||
    !isBoundedString(value.biography, 1000) ||
    !isBoundedString(value.time_zone, 64) ||
    !isBoundedStringArray(value.languages, 8, 64) ||
    !isBoundedStringArray(value.specialties, 12, 64) ||
    !isNullableIsoTimestamp(value.submitted_at) ||
    !isNullableIsoTimestamp(value.reviewed_at) ||
    !isNullableBoundedString(value.decision_reason, 500)
  ) {
    return null;
  }

  return {
    applicationId: value.application_id,
    status: value.status,
    version: value.version as number,
    headline: value.headline,
    biography: value.biography,
    timeZone: value.time_zone,
    languages: [...value.languages],
    specialties: [...value.specialties],
    submittedAt: value.submitted_at,
    reviewedAt: value.reviewed_at,
    decisionReason: value.decision_reason,
  };
}

export function isTutorApplicationDraftValid(draft: TutorApplicationDraft): boolean {
  return (
    draft.headline.length >= 3 &&
    draft.headline.length <= 80 &&
    draft.biography.length >= 20 &&
    draft.biography.length <= 1000 &&
    draft.timeZone.length > 0 &&
    draft.timeZone.length <= 64 &&
    isIanaTimeZone(draft.timeZone) &&
    draft.languages.length > 0 &&
    draft.languages.length <= 8 &&
    draft.languages.every((language) => /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) &&
    draft.specialties.length > 0 &&
    draft.specialties.length <= 12 &&
    draft.specialties.every((specialty) => specialty.length >= 2 && specialty.length <= 64)
  );
}

async function runMarketplaceRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw new TutorMarketplaceClientError('unavailable');
    if (error.kind === 'cancelled') throw error;
    if (
      error.kind === 'http' &&
      error.status === 404 &&
      getErrorCode(error.body) === 'tutor_application_not_found'
    ) {
      throw new TutorMarketplaceClientError('not-found');
    }
    if (error.kind === 'http' && error.status === 403) throw new TutorMarketplaceClientError('forbidden');
    if (error.kind === 'http' && error.status === 409) throw new TutorMarketplaceClientError('conflict');
    if (error.kind === 'http' && error.status === 422) throw new TutorMarketplaceClientError('validation');
    throw new TutorMarketplaceClientError('unavailable');
  }
}

function getErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== 'string') return null;
  return value.error.code;
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isApplicationStatus(value: unknown): value is TutorApplicationStatus {
  return (
    value === 'draft' ||
    value === 'submitted' ||
    value === 'under_review' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'suspended'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value === value.trim();
}

function isBoundedStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxItems &&
    value.every((item) => isBoundedString(item, maxLength))
  );
}

function isNullableBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || isBoundedString(value, maxLength);
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value)));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
