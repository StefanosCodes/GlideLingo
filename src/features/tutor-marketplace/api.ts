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

export type TutorCredential = {
  credentialId: string;
  version: number;
  credentialType: 'certificate' | 'degree' | 'teaching_license';
  title: string;
  issuer: string;
  verificationStatus: 'unverified' | 'verified' | 'rejected';
  verificationReason: string | null;
  reviewedAt: string | null;
};

export type MarketplacePolicyVersion = {
  policyId: string;
  policyType: 'commission' | 'cancellation';
  version: number;
  commissionBasisPoints: number | null;
  cancellationCutoffHours: number | null;
  disputeWindowHours: number | null;
  effectiveAt: string;
};

export type TutorOffering = {
  offeringId: string;
  version: number;
  title: string;
  durationMinutes: 25 | 50;
  amountMinor: number;
  currency: 'USD';
  state: 'draft' | 'active';
  commissionPolicy: MarketplacePolicyVersion;
  cancellationPolicy: MarketplacePolicyVersion;
};

export type TutorProfile = {
  tutorId: string;
  applicationId: string;
  applicationStatus: TutorApplicationStatus;
  version: number;
  headline: string;
  biography: string;
  timeZone: string;
  isPublished: boolean;
  payoutReady: boolean;
  publicationBlockers: ('application_not_approved' | 'payout_not_ready' | 'offering_missing')[];
  credential: TutorCredential | null;
  offering: TutorOffering | null;
};

export type TutorApplicationQueue = {
  items: TutorApplication[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type PublicTutor = {
  tutorId: string;
  headline: string;
  biography: string;
  timeZone: string;
  languages: string[];
  dialects: string[];
  specialties: string[];
  verifiedCredentials: string[];
  offeringId: string;
  offeringTitle: string;
  durationMinutes: 25 | 50;
  amountMinor: number;
  currency: 'USD';
  rating: number | null;
  ratingCount: number;
  isFavorite: boolean;
};

export type TutorSearchResult = { items: PublicTutor[]; nextCursor: string | null };

export type ManualAvailabilityDraft = {
  expectedProfileVersion: number;
  leadTimeMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  dialects: string[];
  rules: { weekday: number; startLocal: string; endLocal: string; effectiveFrom: string; effectiveUntil: string | null }[];
  exceptions: { localDate: string; startLocal: string; endLocal: string; kind: 'available' | 'unavailable' }[];
};

export type ManualAvailability = Omit<ManualAvailabilityDraft, 'expectedProfileVersion'> & {
  tutorId: string;
  profileVersion: number;
  timeZone: string;
};

export type TutorSlot = { startsAt: string; endsAt: string };
export type TutorSlots = { tutorId: string; timeZone: string; source: 'manual'; freshness: 'current'; slots: TutorSlot[] };

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

export async function updateTutorApplicationDraft(
  draft: TutorApplicationDraft,
  expectedVersion: number,
  signal?: AbortSignal,
): Promise<TutorApplication> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        expected_version: expectedVersion,
        headline: draft.headline,
        biography: draft.biography,
        time_zone: draft.timeZone,
        languages: draft.languages,
        specialties: draft.specialties,
      },
      parse: parseTutorApplication,
      path: '/v1/tutor-application/draft',
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

export async function getOwnTutorProfile(signal?: AbortSignal): Promise<TutorProfile> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({ parse: parseTutorProfile, path: '/v1/tutor-profile', signal });
    return result.data;
  });
}

export async function updateTutorProfileDraft(
  input: Pick<TutorProfile, 'headline' | 'biography' | 'timeZone'>,
  expectedVersion: number,
): Promise<TutorProfile> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        expected_version: expectedVersion,
        headline: input.headline,
        biography: input.biography,
        time_zone: input.timeZone,
      },
      parse: parseTutorProfile,
      path: '/v1/tutor-profile/draft',
    });
    return result.data;
  });
}

export async function saveTutorCredential(
  input: Pick<TutorCredential, 'credentialType' | 'title' | 'issuer'>,
  expectedVersion: number,
): Promise<TutorProfile> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        expected_version: expectedVersion,
        credential_type: input.credentialType,
        title: input.title,
        issuer: input.issuer,
      },
      parse: parseTutorProfile,
      path: '/v1/tutor-profile/credential',
    });
    return result.data;
  });
}

export async function saveTutorOffering(
  input: Pick<TutorOffering, 'title' | 'durationMinutes' | 'amountMinor' | 'currency'>,
  expectedVersion: number,
): Promise<TutorProfile> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        expected_version: expectedVersion,
        title: input.title,
        duration_minutes: input.durationMinutes,
        amount_minor: input.amountMinor,
        currency: input.currency,
      },
      parse: parseTutorProfile,
      path: '/v1/tutor-profile/offering',
    });
    return result.data;
  });
}

export async function setTutorPublication(profile: TutorProfile, publish: boolean): Promise<TutorProfile> {
  if (profile.offering === null) throw new TutorMarketplaceClientError('validation');
  const offeringVersion = profile.offering.version;
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        expected_profile_version: profile.version,
        expected_offering_version: offeringVersion,
        publish,
      },
      parse: parseTutorProfile,
      path: '/v1/tutor-profile/publication',
    });
    return result.data;
  });
}

export async function listTutorApplicationsForReview(
  signal?: AbortSignal,
  offset = 0,
  limit = 20,
): Promise<TutorApplicationQueue> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorApplicationQueue,
      path: '/v1/marketplace-operations/tutor-applications',
      query: { limit, offset },
      signal,
    });
    return result.data;
  });
}

export async function listPublicTutors(
  filters: {
    language?: string;
    dialect?: string;
    specialty?: string;
    durationMinutes?: 25 | 50;
    maximumAmountMinor?: number;
    verifiedCredential?: boolean;
    favorite?: boolean;
    availableBefore?: string;
    cursor?: string;
    limit?: number;
  } = {},
  signal?: AbortSignal,
): Promise<TutorSearchResult> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorSearchResult,
      path: '/v1/tutors',
      query: {
        available_before: filters.availableBefore,
        cursor: filters.cursor,
        dialect: filters.dialect,
        duration_minutes: filters.durationMinutes,
        favorite: filters.favorite,
        language: filters.language,
        limit: filters.limit ?? 20,
        maximum_amount_minor: filters.maximumAmountMinor,
        specialty: filters.specialty,
        verified_credential: filters.verifiedCredential,
      },
      signal,
    });
    return result.data;
  });
}

export async function getPublicTutor(tutorId: string, signal?: AbortSignal): Promise<PublicTutor> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({ parse: parsePublicTutor, path: `/v1/tutors/${tutorId}`, signal });
    return result.data;
  });
}

export async function setPublicTutorFavorite(tutorId: string, favorite: boolean): Promise<PublicTutor> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { favorite },
      parse: parsePublicTutor,
      path: `/v1/tutors/${tutorId}/favorite`,
    });
    return result.data;
  });
}

export async function listPublicTutorSlots(
  tutorId: string,
  startsAt: string,
  endsAt: string,
  signal?: AbortSignal,
): Promise<TutorSlots> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorSlots,
      path: `/v1/tutors/${tutorId}/slots`,
      query: { ends_at: endsAt, starts_at: startsAt },
      signal,
    });
    return result.data;
  });
}

export async function getOwnManualAvailability(signal?: AbortSignal): Promise<ManualAvailability> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({ parse: parseManualAvailability, path: '/v1/tutor-availability', signal });
    return result.data;
  });
}

export async function previewOwnManualSlots(
  startsAt: string,
  endsAt: string,
  signal?: AbortSignal,
): Promise<TutorSlots> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorSlots,
      path: '/v1/tutor-availability/preview',
      query: { ends_at: endsAt, starts_at: startsAt },
      signal,
    });
    return result.data;
  });
}

export async function replaceOwnManualAvailability(
  draft: ManualAvailabilityDraft,
): Promise<ManualAvailability> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        expected_profile_version: draft.expectedProfileVersion,
        lead_time_minutes: draft.leadTimeMinutes,
        buffer_before_minutes: draft.bufferBeforeMinutes,
        buffer_after_minutes: draft.bufferAfterMinutes,
        dialects: draft.dialects,
        rules: draft.rules.map((rule) => ({
          weekday: rule.weekday,
          start_local: rule.startLocal,
          end_local: rule.endLocal,
          effective_from: rule.effectiveFrom,
          effective_until: rule.effectiveUntil,
        })),
        exceptions: draft.exceptions.map((exception) => ({
          local_date: exception.localDate,
          start_local: exception.startLocal,
          end_local: exception.endLocal,
          kind: exception.kind,
        })),
      },
      parse: parseManualAvailability,
      path: '/v1/tutor-availability',
    });
    return result.data;
  });
}

export async function getTutorProfileForOperations(applicationId: string): Promise<TutorProfile> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorProfile,
      path: `/v1/marketplace-operations/tutor-applications/${applicationId}/profile`,
    });
    return result.data;
  });
}

export async function decideTutorCredential(
  credential: TutorCredential,
  decision: 'verified' | 'rejected',
  reason: string,
): Promise<TutorProfile> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { decision, expected_version: credential.version, reason },
      parse: parseTutorProfile,
      path: `/v1/marketplace-operations/tutor-credentials/${credential.credentialId}/decision`,
    });
    return result.data;
  });
}

export async function startTutorApplicationReview(application: TutorApplication): Promise<TutorApplication> {
  return postApplicationOperation(
    `/v1/marketplace-operations/tutor-applications/${application.applicationId}/review`,
    { expected_version: application.version },
  );
}

export async function decideTutorApplication(
  application: TutorApplication,
  decision: 'approved' | 'rejected',
  reason: string,
): Promise<TutorApplication> {
  return postApplicationOperation(
    `/v1/marketplace-operations/tutor-applications/${application.applicationId}/decision`,
    { decision, expected_version: application.version, reason },
  );
}

export async function changeTutorStatus(
  application: TutorApplication,
  action: 'suspend' | 'reinstate',
  reason: string,
): Promise<TutorApplication> {
  return postApplicationOperation(
    `/v1/marketplace-operations/tutor-applications/${application.applicationId}/status`,
    { action, expected_version: application.version, reason },
  );
}

async function postApplicationOperation(
  path: `/${string}`,
  body: unknown,
): Promise<TutorApplication> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({ body, parse: parseTutorApplication, path });
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

export function parseTutorApplicationQueue(value: unknown): TutorApplicationQueue | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.offset) ||
    (value.offset as number) < 0 ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 50 ||
    typeof value.has_more !== 'boolean'
  ) {
    return null;
  }
  const items = value.items.map(parseTutorApplication);
  if (items.some((item) => item === null)) return null;
  return {
    items: items as TutorApplication[],
    offset: value.offset as number,
    limit: value.limit as number,
    hasMore: value.has_more,
  };
}

export function parsePublicTutor(value: unknown): PublicTutor | null {
  if (
    !isRecord(value) || !isUuid(value.tutor_id) || !isBoundedString(value.headline, 80) ||
    !isBoundedString(value.biography, 1000) || !isBoundedString(value.time_zone, 64) ||
    !isBoundedStringArrayAllowEmpty(value.languages, 8, 64) ||
    !isBoundedStringArrayAllowEmpty(value.dialects, 8, 64) ||
    !isBoundedStringArrayAllowEmpty(value.specialties, 12, 64) ||
    !isBoundedStringArrayAllowEmpty(value.verified_credentials, 8, 100) ||
    !isUuid(value.offering_id) || !isBoundedString(value.offering_title, 100) ||
    (value.duration_minutes !== 25 && value.duration_minutes !== 50) ||
    !Number.isSafeInteger(value.amount_minor) || (value.amount_minor as number) < 500 ||
    value.currency !== 'USD' ||
    !(value.rating === null || (typeof value.rating === 'number' && value.rating >= 1 && value.rating <= 5)) ||
    !Number.isSafeInteger(value.rating_count) || (value.rating_count as number) < 0 ||
    typeof value.is_favorite !== 'boolean'
  ) return null;
  return {
    tutorId: value.tutor_id, headline: value.headline, biography: value.biography,
    timeZone: value.time_zone, languages: [...value.languages], dialects: [...value.dialects],
    specialties: [...value.specialties], verifiedCredentials: [...value.verified_credentials],
    offeringId: value.offering_id, offeringTitle: value.offering_title,
    durationMinutes: value.duration_minutes, amountMinor: value.amount_minor as number,
    currency: value.currency, rating: value.rating as number | null,
    ratingCount: value.rating_count as number, isFavorite: value.is_favorite,
  };
}

export function parseTutorSearchResult(value: unknown): TutorSearchResult | null {
  if (!isRecord(value) || !Array.isArray(value.items) ||
      !(value.next_cursor === null || (typeof value.next_cursor === 'string' && value.next_cursor.length <= 512))) return null;
  const items = value.items.map(parsePublicTutor);
  if (items.some((item) => item === null)) return null;
  return { items: items as PublicTutor[], nextCursor: value.next_cursor };
}

export function parseTutorSlots(value: unknown): TutorSlots | null {
  if (!isRecord(value) || !isUuid(value.tutor_id) || !isBoundedString(value.time_zone, 64) ||
      value.source !== 'manual' || value.freshness !== 'current' || !Array.isArray(value.slots) ||
      value.slots.length > 256) return null;
  const slots = value.slots.map((slot): TutorSlot | null => {
    if (!isRecord(slot) || !isIsoTimestamp(slot.starts_at) || !isIsoTimestamp(slot.ends_at) ||
        Date.parse(slot.starts_at) >= Date.parse(slot.ends_at)) return null;
    return { startsAt: slot.starts_at, endsAt: slot.ends_at };
  });
  if (slots.some((slot) => slot === null)) return null;
  return { tutorId: value.tutor_id, timeZone: value.time_zone, source: 'manual', freshness: 'current', slots: slots as TutorSlot[] };
}

export function parseManualAvailability(value: unknown): ManualAvailability | null {
  if (!isRecord(value) || !isUuid(value.tutor_id) || !isPositiveVersion(value.profile_version) ||
      !isBoundedString(value.time_zone, 64) || !Number.isSafeInteger(value.lead_time_minutes) ||
      !Number.isSafeInteger(value.buffer_before_minutes) || !Number.isSafeInteger(value.buffer_after_minutes) ||
      !isBoundedStringArrayAllowEmpty(value.dialects, 8, 64) || !Array.isArray(value.rules) ||
      value.rules.length > 28 || !Array.isArray(value.exceptions) || value.exceptions.length > 64) return null;
  const rules = value.rules.map((rule) => {
    if (!isRecord(rule) || !Number.isSafeInteger(rule.weekday) || (rule.weekday as number) < 0 ||
        (rule.weekday as number) > 6 || !isLocalTime(rule.start_local) || !isLocalTime(rule.end_local) ||
        !isDate(rule.effective_from) || !(rule.effective_until === null || isDate(rule.effective_until))) return null;
    return { weekday: rule.weekday as number, startLocal: rule.start_local, endLocal: rule.end_local,
      effectiveFrom: rule.effective_from, effectiveUntil: rule.effective_until as string | null };
  });
  const exceptions = value.exceptions.map((exception) => {
    if (!isRecord(exception) || !isDate(exception.local_date) || !isLocalTime(exception.start_local) ||
        !isLocalTime(exception.end_local) || (exception.kind !== 'available' && exception.kind !== 'unavailable')) return null;
    return { localDate: exception.local_date, startLocal: exception.start_local,
      endLocal: exception.end_local, kind: exception.kind };
  });
  if (rules.some((rule) => rule === null) || exceptions.some((exception) => exception === null)) return null;
  return {
    tutorId: value.tutor_id, profileVersion: value.profile_version as number, timeZone: value.time_zone,
    leadTimeMinutes: value.lead_time_minutes as number,
    bufferBeforeMinutes: value.buffer_before_minutes as number,
    bufferAfterMinutes: value.buffer_after_minutes as number, dialects: [...value.dialects],
    rules: rules as ManualAvailability['rules'], exceptions: exceptions as ManualAvailability['exceptions'],
  };
}

export function parseTutorProfile(value: unknown): TutorProfile | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tutor_id) ||
    !isUuid(value.application_id) ||
    !isApplicationStatus(value.application_status) ||
    !isPositiveVersion(value.version) ||
    !isBoundedString(value.headline, 80) ||
    !isBoundedString(value.biography, 1000) ||
    !isBoundedString(value.time_zone, 64) ||
    typeof value.is_published !== 'boolean' ||
    typeof value.payout_ready !== 'boolean' ||
    !isPublicationBlockers(value.publication_blockers)
  ) {
    return null;
  }
  const credential = value.credential === null ? null : parseTutorCredential(value.credential);
  const offering = value.offering === null ? null : parseTutorOffering(value.offering);
  if ((value.credential !== null && credential === null) || (value.offering !== null && offering === null)) {
    return null;
  }
  return {
    tutorId: value.tutor_id,
    applicationId: value.application_id,
    applicationStatus: value.application_status,
    version: value.version as number,
    headline: value.headline,
    biography: value.biography,
    timeZone: value.time_zone,
    isPublished: value.is_published,
    payoutReady: value.payout_ready,
    publicationBlockers: [...value.publication_blockers],
    credential,
    offering,
  };
}

function parseTutorCredential(value: unknown): TutorCredential | null {
  if (
    !isRecord(value) ||
    !isUuid(value.credential_id) ||
    !isPositiveVersion(value.version) ||
    !isCredentialType(value.credential_type) ||
    !isBoundedString(value.title, 100) ||
    !isBoundedString(value.issuer, 100) ||
    !isCredentialStatus(value.verification_status) ||
    !isNullableBoundedString(value.verification_reason, 500) ||
    !isNullableIsoTimestamp(value.reviewed_at)
  ) {
    return null;
  }
  return {
    credentialId: value.credential_id,
    version: value.version as number,
    credentialType: value.credential_type,
    title: value.title,
    issuer: value.issuer,
    verificationStatus: value.verification_status,
    verificationReason: value.verification_reason,
    reviewedAt: value.reviewed_at,
  };
}

function parseTutorOffering(value: unknown): TutorOffering | null {
  if (
    !isRecord(value) ||
    !isUuid(value.offering_id) ||
    !isPositiveVersion(value.version) ||
    !isBoundedString(value.title, 100) ||
    (value.duration_minutes !== 25 && value.duration_minutes !== 50) ||
    !Number.isSafeInteger(value.amount_minor) ||
    (value.amount_minor as number) < 500 ||
    (value.amount_minor as number) > 50_000 ||
    value.currency !== 'USD' ||
    (value.state !== 'draft' && value.state !== 'active')
  ) {
    return null;
  }
  const commissionPolicy = parsePolicy(value.commission_policy, 'commission');
  const cancellationPolicy = parsePolicy(value.cancellation_policy, 'cancellation');
  if (commissionPolicy === null || cancellationPolicy === null) return null;
  return {
    offeringId: value.offering_id,
    version: value.version as number,
    title: value.title,
    durationMinutes: value.duration_minutes,
    amountMinor: value.amount_minor as number,
    currency: value.currency,
    state: value.state,
    commissionPolicy,
    cancellationPolicy,
  };
}

function parsePolicy(
  value: unknown,
  expectedType: MarketplacePolicyVersion['policyType'],
): MarketplacePolicyVersion | null {
  if (
    !isRecord(value) ||
    !isUuid(value.policy_id) ||
    value.policy_type !== expectedType ||
    !isPositiveVersion(value.version) ||
    !isNullableInteger(value.commission_basis_points, 0, 10_000) ||
    !isNullableInteger(value.cancellation_cutoff_hours, 0, 168) ||
    !isNullableInteger(value.dispute_window_hours, 1, 168) ||
    !isIsoTimestamp(value.effective_at)
  ) {
    return null;
  }
  if (
    (expectedType === 'commission' &&
      (value.commission_basis_points === null ||
        value.cancellation_cutoff_hours !== null ||
        value.dispute_window_hours !== null)) ||
    (expectedType === 'cancellation' &&
      (value.commission_basis_points !== null ||
        value.cancellation_cutoff_hours === null ||
        value.dispute_window_hours === null))
  ) {
    return null;
  }
  return {
    policyId: value.policy_id,
    policyType: expectedType,
    version: value.version as number,
    commissionBasisPoints: value.commission_basis_points as number | null,
    cancellationCutoffHours: value.cancellation_cutoff_hours as number | null,
    disputeWindowHours: value.dispute_window_hours as number | null,
    effectiveAt: value.effective_at,
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

function isCredentialType(value: unknown): value is TutorCredential['credentialType'] {
  return value === 'certificate' || value === 'degree' || value === 'teaching_license';
}

function isCredentialStatus(value: unknown): value is TutorCredential['verificationStatus'] {
  return value === 'unverified' || value === 'verified' || value === 'rejected';
}

function isPublicationBlockers(value: unknown): value is TutorProfile['publicationBlockers'] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    new Set(value).size === value.length &&
    value.every(
      (item) =>
        item === 'application_not_approved' || item === 'payout_not_ready' || item === 'offering_missing',
    )
  );
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isNullableInteger(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum);
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

function isBoundedStringArrayAllowEmpty(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => isBoundedString(item, maxLength));
}

function isLocalTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isNullableBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || isBoundedString(value, maxLength);
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
