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

export type MarketplaceReview = {
  reviewId: string;
  bookingId: string;
  tutorId: string;
  rating: number;
  body: string | null;
  moderationState: 'published' | 'hidden';
  moderationReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
};

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
export type TutorSlots = {
  tutorId: string;
  timeZone: string;
  source: 'manual' | 'manual+google';
  freshness: 'current' | 'stale' | 'reconnect_required';
  slots: TutorSlot[];
};

export type CalendarConnection = {
  status: 'disconnected' | 'connected' | 'stale' | 'reconnect_required';
  freshness: 'not_connected' | 'current' | 'stale' | 'reconnect_required';
  lastRefreshedAt: string | null;
  safeFailureCode: string | null;
};

export type CalendarOAuthStart = { authorizationUrl: string; expiresAt: string };

export type MarketplaceConversation = {
  conversationId: string;
  tutorId: string;
  participantRole: 'learner' | 'tutor';
  state: 'open' | 'closed';
  updatedAt: string;
};

export type MarketplaceMessage = {
  messageId: string;
  kind: 'user' | 'system';
  senderRole: 'learner' | 'tutor' | 'system';
  body: string;
  isOwn: boolean;
  createdAt: string;
};

export type MarketplaceMessagePage = { items: MarketplaceMessage[]; nextCursor: string | null };
export type MarketplaceMessageReport = {
  reportId: string;
  conversationId: string;
  messageId: string | null;
  reason: 'harassment' | 'spam' | 'unsafe' | 'other';
  details: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  messages: MarketplaceMessage[];
};

export type TutorConnectStatus = {
  status: 'not_started' | 'incomplete' | 'ready' | 'restricted';
  requirementsDue: number;
};

export type MarketplaceBooking = {
  bookingId: string;
  role: 'learner' | 'tutor' | 'operator';
  tutorId: string;
  state: 'held' | 'payment_pending' | 'payment_ambiguous' | 'payment_failed' | 'confirmed' | 'completed' | 'cancelled' | 'learner_no_show' | 'tutor_no_show' | 'disputed' | 'resolved_refund' | 'resolved_release' | 'expired';
  startsAt: string;
  endsAt: string;
  holdExpiresAt: string;
  amountMinor: number;
  currency: 'USD';
  commissionAmountMinor: number;
  tutorAmountMinor: number;
  checkoutUrl: string | null;
  meetingUrl: string | null;
  ics: string | null;
  scheduleVersion: number;
  moneyState: 'charged' | 'refund_pending' | 'refund_ambiguous' | 'refunded' | 'transfer_pending' | 'transfer_ambiguous' | 'transferred' | 'reversal_pending' | 'reversal_ambiguous' | 'reversed' | null;
  disputeDeadlineAt: string | null;
};

export type TutorEarnings = { pendingMinor: number; transferredMinor: number; currency: 'USD' };

export type LearningBrief = {
  selectedGoal: string;
  languageCode: string;
  courseId: string | null;
  courseTitle: string | null;
  capabilities: string[];
  reviewFocus: string[];
};

export type TutorFollowUpRecommendation = {
  kind: 'course_content' | 'free_text';
  contentReference: string | null;
  recommendation: string;
};

export type TutorFollowUp = {
  followUpId: string;
  version: number;
  summary: string;
  recommendations: TutorFollowUpRecommendation[];
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceLearningContext = {
  bookingId: string;
  role: 'learner' | 'tutor';
  consentState: 'not_shared' | 'granted' | 'revoked' | 'expired';
  accessExpiresAt: string | null;
  brief: LearningBrief | null;
  followUp: TutorFollowUp | null;
};

export class TutorMarketplaceClientError extends Error {
  readonly kind: 'not-found' | 'forbidden' | 'conflict' | 'limited' | 'validation' | 'unavailable';

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
    minimumRating?: number;
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
        minimum_rating: filters.minimumRating,
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

export async function getTutorCalendarConnection(signal?: AbortSignal): Promise<CalendarConnection> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({ parse: parseCalendarConnection, path: '/v1/tutor-calendar', signal });
    return result.data;
  });
}

export async function startTutorCalendarOAuth(
  redirectUri: string,
  signal?: AbortSignal,
): Promise<CalendarOAuthStart> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { redirect_uri: redirectUri },
      parse: parseCalendarOAuthStart,
      path: '/v1/tutor-calendar/oauth/start',
      signal,
    });
    return result.data;
  });
}

export async function completeTutorCalendarOAuth(
  state: string,
  code: string,
  redirectUri: string,
): Promise<CalendarConnection> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { state, code, redirect_uri: redirectUri },
      parse: parseCalendarConnection,
      path: '/v1/tutor-calendar/oauth/callback',
    });
    return result.data;
  });
}

export async function refreshTutorCalendar(): Promise<CalendarConnection> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {}, parse: parseCalendarConnection, path: '/v1/tutor-calendar/refresh',
    });
    return result.data;
  });
}

export async function revokeTutorCalendar(): Promise<CalendarConnection> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {}, parse: parseCalendarConnection, path: '/v1/tutor-calendar/revoke',
    });
    return result.data;
  });
}

export async function createMarketplaceConversation(
  tutorId: string,
): Promise<MarketplaceConversation> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { tutor_id: tutorId },
      parse: parseMarketplaceConversation,
      path: '/v1/conversations',
    });
    return result.data;
  });
}

export async function getTutorConnectStatus(
  refresh = false,
  signal?: AbortSignal,
): Promise<TutorConnectStatus> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseTutorConnectStatus,
      path: '/v1/tutor-connect',
      query: { refresh },
      signal,
    });
    return result.data;
  });
}

export async function createTutorConnectOnboarding(): Promise<{ url: string; expiresAt: string }> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {},
      parse: (value) => {
        if (!isRecord(value) || !isSafeStripeConnectUrl(value.url) || !isIsoTimestamp(value.expires_at)) return null;
        return { url: value.url, expiresAt: value.expires_at };
      },
      path: '/v1/tutor-connect/onboarding',
    });
    return result.data;
  });
}

export async function saveTutorMeetingUrl(url: string): Promise<void> {
  await runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { url },
      parse: (value) => isRecord(value) && value.success === true ? true : null,
      path: '/v1/tutor-meeting',
    });
    return result.data;
  });
}

export async function createBookingCheckout(
  tutorId: string,
  startsAt: string,
  idempotencyKey: string,
): Promise<MarketplaceBooking> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { tutor_id: tutorId, starts_at: startsAt, idempotency_key: idempotencyKey },
      parse: parseMarketplaceBooking,
      path: '/v1/bookings/checkout',
    });
    return result.data;
  });
}

export async function listMarketplaceBookings(signal?: AbortSignal): Promise<MarketplaceBooking[]> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: (value) => {
        if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100) return null;
        const items = value.items.map(parseMarketplaceBooking);
        return items.some((item) => item === null) ? null : items as MarketplaceBooking[];
      },
      path: '/v1/bookings',
      signal,
    });
    return result.data;
  });
}

export async function getMarketplaceBooking(
  bookingId: string,
  signal?: AbortSignal,
): Promise<MarketplaceBooking> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseMarketplaceBooking,
      path: `/v1/bookings/${bookingId}`,
      signal,
    });
    return result.data;
  });
}

export async function reconcileMarketplaceBooking(bookingId: string): Promise<MarketplaceBooking> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {},
      parse: parseMarketplaceBooking,
      path: `/v1/bookings/${bookingId}/reconcile`,
    });
    return result.data;
  });
}

export async function recoverMarketplaceBookingMoney(
  bookingId: string,
  reason: string,
): Promise<MarketplaceBooking> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { reason },
      parse: parseMarketplaceBooking,
      path: `/v1/marketplace-operations/bookings/${bookingId}/money-recovery`,
    });
    return result.data;
  });
}

export async function transitionMarketplaceBooking(
  bookingId: string,
  action: 'reschedule' | 'cancel' | 'complete' | 'learner_no_show' | 'tutor_no_show' | 'dispute' | 'resolve_refund' | 'resolve_release',
  reason: string,
  newStartsAt: string | null = null,
): Promise<MarketplaceBooking> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { action, reason, new_starts_at: newStartsAt },
      parse: parseMarketplaceBooking,
      path: `/v1/bookings/${bookingId}/transition`,
    });
    return result.data;
  });
}

export async function createMarketplaceBookingReview(
  bookingId: string,
  rating: number,
  body: string | null,
): Promise<void> {
  await runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { rating, body },
      parse: (value) => isRecord(value) && isUuid(value.review_id) &&
        value.booking_id === bookingId && value.rating === rating ? true : null,
      path: `/v1/bookings/${bookingId}/review`,
    });
    return result.data;
  });
}

export async function listMarketplaceReviews(signal?: AbortSignal): Promise<MarketplaceReview[]> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: (value) => {
        if (!isRecord(value) || !Array.isArray(value.items)) return null;
        const items = value.items.map(parseMarketplaceReview);
        return items.every((item): item is MarketplaceReview => item !== null) ? items : null;
      },
      path: '/v1/marketplace-operations/reviews',
      query: { limit: 50 },
      signal,
    });
    return result.data;
  });
}

export async function moderateMarketplaceReview(
  reviewId: string,
  moderationState: 'published' | 'hidden',
  reason: string,
): Promise<MarketplaceReview> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { moderation_state: moderationState, reason },
      parse: parseMarketplaceReview,
      path: `/v1/marketplace-operations/reviews/${reviewId}/moderation`,
    });
    return result.data;
  });
}

export function parseMarketplaceReview(value: unknown): MarketplaceReview | null {
  if (!isRecord(value) || !isUuid(value.review_id) || !isUuid(value.booking_id) ||
    !isUuid(value.tutor_id) || typeof value.rating !== 'number' || !Number.isInteger(value.rating) ||
    value.rating < 1 || value.rating > 5 ||
    (value.body !== null && typeof value.body !== 'string') ||
    (value.moderation_state !== 'published' && value.moderation_state !== 'hidden') ||
    (value.moderation_reason !== null && typeof value.moderation_reason !== 'string') ||
    !isNullableIsoTimestamp(value.moderated_at) || !isIsoTimestamp(value.created_at)) return null;
  return {
    reviewId: value.review_id, bookingId: value.booking_id, tutorId: value.tutor_id,
    rating: value.rating as number, body: value.body as string | null,
    moderationState: value.moderation_state, moderationReason: value.moderation_reason as string | null,
    moderatedAt: value.moderated_at, createdAt: value.created_at,
  };
}

export async function getTutorEarnings(signal?: AbortSignal): Promise<TutorEarnings> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: (value) => isRecord(value) && isMinorAmountOrZero(value.pending_minor) &&
        isMinorAmountOrZero(value.transferred_minor) && value.currency === 'USD'
        ? { pendingMinor: value.pending_minor, transferredMinor: value.transferred_minor, currency: 'USD' as const }
        : null,
      path: '/v1/tutor-earnings',
      signal,
    });
    return result.data;
  });
}

export async function getMarketplaceLearningContext(
  bookingId: string,
  signal?: AbortSignal,
): Promise<MarketplaceLearningContext> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseMarketplaceLearningContext,
      path: `/v1/bookings/${bookingId}/learning-context`,
      signal,
    });
    return result.data;
  });
}

export async function saveMarketplaceLearningContext(
  bookingId: string,
  brief: LearningBrief,
): Promise<MarketplaceLearningContext> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        selected_goal: brief.selectedGoal,
        language_code: brief.languageCode,
        course_id: brief.courseId,
        course_title: brief.courseTitle,
        capabilities: brief.capabilities,
        review_focus: brief.reviewFocus,
      },
      parse: parseMarketplaceLearningContext,
      path: `/v1/bookings/${bookingId}/learning-context`,
    });
    return result.data;
  });
}

export async function revokeMarketplaceLearningContext(
  bookingId: string,
): Promise<MarketplaceLearningContext> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {},
      parse: parseMarketplaceLearningContext,
      path: `/v1/bookings/${bookingId}/learning-context/revoke`,
    });
    return result.data;
  });
}

export async function saveMarketplaceTutorFollowUp(
  bookingId: string,
  summary: string,
  recommendations: TutorFollowUpRecommendation[],
): Promise<MarketplaceLearningContext> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {
        summary,
        recommendations: recommendations.map((item) => ({
          kind: item.kind,
          content_reference: item.contentReference,
          recommendation: item.recommendation,
        })),
      },
      parse: parseMarketplaceLearningContext,
      path: `/v1/bookings/${bookingId}/tutor-follow-up`,
    });
    return result.data;
  });
}

export async function listMarketplaceConversations(
  signal?: AbortSignal,
): Promise<MarketplaceConversation[]> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: (value) => {
        if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100) return null;
        const items = value.items.map(parseMarketplaceConversation);
        return items.some((item) => item === null) ? null : items as MarketplaceConversation[];
      },
      path: '/v1/conversations',
      signal,
    });
    return result.data;
  });
}

export async function getMarketplaceMessageEmailPreference(signal?: AbortSignal): Promise<boolean> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: (value) => isRecord(value) && typeof value.email_enabled === 'boolean'
        ? value.email_enabled : null,
      path: '/v1/message-notification-preference',
      signal,
    });
    return result.data;
  });
}

export async function setMarketplaceMessageEmailPreference(emailEnabled: boolean): Promise<boolean> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { email_enabled: emailEnabled },
      parse: (value) => isRecord(value) && typeof value.email_enabled === 'boolean'
        ? value.email_enabled : null,
      path: '/v1/message-notification-preference',
    });
    return result.data;
  });
}

export async function listMarketplaceMessages(
  conversationId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<MarketplaceMessagePage> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseMarketplaceMessagePage,
      path: `/v1/conversations/${conversationId}/messages`,
      query: { cursor },
      signal,
    });
    return result.data;
  });
}

export async function sendMarketplaceMessage(
  conversationId: string,
  clientMessageId: string,
  body: string,
): Promise<MarketplaceMessage> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { client_message_id: clientMessageId, body },
      parse: parseMarketplaceMessage,
      path: `/v1/conversations/${conversationId}/messages`,
    });
    return result.data;
  });
}

export async function blockMarketplaceParticipant(conversationId: string): Promise<void> {
  await runMarketplaceRequest(async () => {
    const result = await postJson({
      body: {},
      parse: (value) => isRecord(value) && value.success === true ? true : null,
      path: `/v1/conversations/${conversationId}/block`,
    });
    return result.data;
  });
}

export async function reportMarketplaceMessage(
  conversationId: string,
  messageId: string | null,
  reason: MarketplaceMessageReport['reason'],
  details: string | null,
): Promise<MarketplaceMessageReport> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { message_id: messageId, reason, details },
      parse: parseMarketplaceMessageReport,
      path: `/v1/conversations/${conversationId}/reports`,
    });
    return result.data;
  });
}

export async function listMarketplaceMessageReports(
  signal?: AbortSignal,
): Promise<MarketplaceMessageReport[]> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: (value) => {
        if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100) return null;
        const items = value.items.map(parseMarketplaceMessageReport);
        return items.some((item) => item === null) ? null : items as MarketplaceMessageReport[];
      },
      path: '/v1/marketplace-operations/message-reports',
      signal,
    });
    return result.data;
  });
}

export async function getMarketplaceMessageReport(
  reportId: string,
  signal?: AbortSignal,
): Promise<MarketplaceMessageReport> {
  return runMarketplaceRequest(async () => {
    const result = await getJson({
      parse: parseMarketplaceMessageReport,
      path: `/v1/marketplace-operations/message-reports/${reportId}`,
      signal,
    });
    return result.data;
  });
}

export async function resolveMarketplaceMessageReport(
  reportId: string,
  reason: string,
): Promise<MarketplaceMessageReport> {
  return runMarketplaceRequest(async () => {
    const result = await postJson({
      body: { reason },
      parse: parseMarketplaceMessageReport,
      path: `/v1/marketplace-operations/message-reports/${reportId}/resolve`,
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
      (value.source !== 'manual' && value.source !== 'manual+google') ||
      !['current', 'stale', 'reconnect_required'].includes(value.freshness as string) ||
      !Array.isArray(value.slots) ||
      value.slots.length > 256) return null;
  const slots = value.slots.map((slot): TutorSlot | null => {
    if (!isRecord(slot) || !isIsoTimestamp(slot.starts_at) || !isIsoTimestamp(slot.ends_at) ||
        Date.parse(slot.starts_at) >= Date.parse(slot.ends_at)) return null;
    return { startsAt: slot.starts_at, endsAt: slot.ends_at };
  });
  if (slots.some((slot) => slot === null)) return null;
  return {
    tutorId: value.tutor_id, timeZone: value.time_zone,
    source: value.source, freshness: value.freshness as TutorSlots['freshness'], slots: slots as TutorSlot[],
  };
}

export function parseTutorConnectStatus(value: unknown): TutorConnectStatus | null {
  if (!isRecord(value) ||
      !['not_started', 'incomplete', 'ready', 'restricted'].includes(value.status as string) ||
      !Number.isSafeInteger(value.requirements_due) ||
      (value.requirements_due as number) < 0 || (value.requirements_due as number) > 100) return null;
  return {
    status: value.status as TutorConnectStatus['status'],
    requirementsDue: value.requirements_due as number,
  };
}

export function parseMarketplaceBooking(value: unknown): MarketplaceBooking | null {
  if (!isRecord(value) || !isUuid(value.booking_id) || !isUuid(value.tutor_id) ||
      !['learner', 'tutor', 'operator'].includes(value.role as string) ||
      !['held', 'payment_pending', 'payment_ambiguous', 'payment_failed', 'confirmed', 'completed',
        'cancelled', 'learner_no_show', 'tutor_no_show', 'disputed', 'resolved_refund',
        'resolved_release', 'expired']
        .includes(value.state as string) ||
      !isIsoTimestamp(value.starts_at) || !isIsoTimestamp(value.ends_at) ||
      !isIsoTimestamp(value.hold_expires_at) || Date.parse(value.starts_at) >= Date.parse(value.ends_at) ||
      !isMinorAmount(value.amount_minor) || value.currency !== 'USD' ||
      !isMinorAmountOrZero(value.commission_amount_minor) || !isMinorAmountOrZero(value.tutor_amount_minor) ||
      !(value.checkout_url === null || isSafeStripeCheckoutUrl(value.checkout_url)) ||
      !(value.meeting_url === null || isSafeHttpsUrl(value.meeting_url, 1000)) ||
      !(value.ics === null || (typeof value.ics === 'string' && value.ics.length <= 4000 && value.ics.startsWith('BEGIN:VCALENDAR'))) ||
      !Number.isSafeInteger(value.schedule_version) || (value.schedule_version as number) < 1 ||
      !(value.money_state === null || ['charged', 'refund_pending', 'refund_ambiguous', 'refunded',
        'transfer_pending', 'transfer_ambiguous', 'transferred', 'reversal_pending',
        'reversal_ambiguous', 'reversed'].includes(value.money_state as string)) ||
      !isNullableIsoTimestamp(value.dispute_deadline_at)) {
    return null;
  }
  const protectedStates = ['confirmed', 'completed', 'learner_no_show', 'disputed', 'resolved_release'];
  if (protectedStates.includes(value.state as string) !== (value.meeting_url !== null && value.ics !== null)) return null;
  return {
    bookingId: value.booking_id, role: value.role as MarketplaceBooking['role'], tutorId: value.tutor_id,
    state: value.state as MarketplaceBooking['state'], startsAt: value.starts_at,
    endsAt: value.ends_at, holdExpiresAt: value.hold_expires_at,
    amountMinor: value.amount_minor as number, currency: value.currency,
    commissionAmountMinor: value.commission_amount_minor as number,
    tutorAmountMinor: value.tutor_amount_minor as number,
    checkoutUrl: value.checkout_url, meetingUrl: value.meeting_url, ics: value.ics,
    scheduleVersion: value.schedule_version as number,
    moneyState: value.money_state as MarketplaceBooking['moneyState'],
    disputeDeadlineAt: value.dispute_deadline_at,
  };
}

export function parseMarketplaceLearningContext(value: unknown): MarketplaceLearningContext | null {
  if (!isRecord(value) || !isUuid(value.booking_id) ||
      !['learner', 'tutor'].includes(value.role as string) ||
      !['not_shared', 'granted', 'revoked', 'expired'].includes(value.consent_state as string) ||
      !isNullableIsoTimestamp(value.access_expires_at)) return null;
  let brief: LearningBrief | null = null;
  if (value.brief !== null) {
    if (!isRecord(value.brief) || !isBoundedString(value.brief.selected_goal, 300) ||
        !isBoundedString(value.brief.language_code, 64) ||
        !isNullableBoundedString(value.brief.course_id, 100) ||
        !isNullableBoundedString(value.brief.course_title, 200) ||
        ((value.brief.course_id === null) !== (value.brief.course_title === null)) ||
        !isBoundedStringArrayAllowEmpty(value.brief.capabilities, 12, 160) ||
        !isBoundedStringArrayAllowEmpty(value.brief.review_focus, 12, 160)) return null;
    brief = {
      selectedGoal: value.brief.selected_goal,
      languageCode: value.brief.language_code,
      courseId: value.brief.course_id,
      courseTitle: value.brief.course_title,
      capabilities: value.brief.capabilities,
      reviewFocus: value.brief.review_focus,
    };
  }
  let followUp: TutorFollowUp | null = null;
  if (value.follow_up !== null) {
    const follow = value.follow_up;
    if (!isRecord(follow) || !isUuid(follow.follow_up_id) || !isPositiveVersion(follow.version) ||
        !isBoundedString(follow.summary, 2000) || !isIsoTimestamp(follow.created_at) ||
        !isIsoTimestamp(follow.updated_at) || !Array.isArray(follow.recommendations) ||
        follow.recommendations.length > 8) return null;
    const recommendations: TutorFollowUpRecommendation[] = [];
    for (const item of follow.recommendations) {
      if (!isRecord(item) || !['course_content', 'free_text'].includes(item.kind as string) ||
          !isNullableBoundedString(item.content_reference, 160) ||
          !isBoundedString(item.recommendation, 500) ||
          ((item.kind === 'course_content') !== (item.content_reference !== null))) return null;
      recommendations.push({
        kind: item.kind as TutorFollowUpRecommendation['kind'],
        contentReference: item.content_reference,
        recommendation: item.recommendation,
      });
    }
    followUp = {
      followUpId: follow.follow_up_id,
      version: follow.version,
      summary: follow.summary,
      recommendations,
      createdAt: follow.created_at,
      updatedAt: follow.updated_at,
    };
  }
  if ((value.consent_state === 'granted') !== (brief !== null && value.access_expires_at !== null)) return null;
  return {
    bookingId: value.booking_id,
    role: value.role as MarketplaceLearningContext['role'],
    consentState: value.consent_state as MarketplaceLearningContext['consentState'],
    accessExpiresAt: value.access_expires_at,
    brief,
    followUp,
  };
}

export function parseCalendarConnection(value: unknown): CalendarConnection | null {
  if (!isRecord(value) ||
      !['disconnected', 'connected', 'stale', 'reconnect_required'].includes(value.status as string) ||
      !['not_connected', 'current', 'stale', 'reconnect_required'].includes(value.freshness as string) ||
      !(value.last_refreshed_at === null || isIsoTimestamp(value.last_refreshed_at)) ||
      !(value.safe_failure_code === null || isBoundedString(value.safe_failure_code, 64))) return null;
  return {
    status: value.status as CalendarConnection['status'],
    freshness: value.freshness as CalendarConnection['freshness'],
    lastRefreshedAt: value.last_refreshed_at,
    safeFailureCode: value.safe_failure_code,
  };
}

export function parseCalendarOAuthStart(value: unknown): CalendarOAuthStart | null {
  if (!isRecord(value) || !isBoundedString(value.authorization_url, 4096) ||
      !value.authorization_url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?') ||
      !isIsoTimestamp(value.expires_at)) return null;
  return { authorizationUrl: value.authorization_url, expiresAt: value.expires_at };
}

export function parseMarketplaceConversation(value: unknown): MarketplaceConversation | null {
  if (!isRecord(value) || !isUuid(value.conversation_id) || !isUuid(value.tutor_id) ||
      (value.participant_role !== 'learner' && value.participant_role !== 'tutor') ||
      (value.state !== 'open' && value.state !== 'closed') || !isIsoTimestamp(value.updated_at)) return null;
  return {
    conversationId: value.conversation_id, tutorId: value.tutor_id,
    participantRole: value.participant_role, state: value.state, updatedAt: value.updated_at,
  };
}

export function parseMarketplaceMessage(value: unknown): MarketplaceMessage | null {
  if (!isRecord(value) || !isUuid(value.message_id) ||
      (value.kind !== 'user' && value.kind !== 'system') ||
      !['learner', 'tutor', 'system'].includes(value.sender_role as string) ||
      !isBoundedString(value.body, 2000) || typeof value.is_own !== 'boolean' ||
      !isIsoTimestamp(value.created_at)) return null;
  return {
    messageId: value.message_id, kind: value.kind,
    senderRole: value.sender_role as MarketplaceMessage['senderRole'], body: value.body,
    isOwn: value.is_own, createdAt: value.created_at,
  };
}

export function parseMarketplaceMessagePage(value: unknown): MarketplaceMessagePage | null {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100 ||
      !(value.next_cursor === null || isBoundedString(value.next_cursor, 512))) return null;
  const items = value.items.map(parseMarketplaceMessage);
  return items.some((item) => item === null)
    ? null
    : { items: items as MarketplaceMessage[], nextCursor: value.next_cursor };
}

export function parseMarketplaceMessageReport(value: unknown): MarketplaceMessageReport | null {
  if (!isRecord(value) || !isUuid(value.report_id) || !isUuid(value.conversation_id) ||
      !(value.message_id === null || isUuid(value.message_id)) ||
      !['harassment', 'spam', 'unsafe', 'other'].includes(value.reason as string) ||
      !(value.details === null || isBoundedString(value.details, 1000)) ||
      (value.status !== 'open' && value.status !== 'resolved') ||
      !isIsoTimestamp(value.created_at) || !Array.isArray(value.messages) || value.messages.length > 201) return null;
  const messages = value.messages.map(parseMarketplaceMessage);
  if (messages.some((message) => message === null)) return null;
  return {
    reportId: value.report_id, conversationId: value.conversation_id,
    messageId: value.message_id, reason: value.reason as MarketplaceMessageReport['reason'],
    details: value.details, status: value.status, createdAt: value.created_at,
    messages: messages as MarketplaceMessage[],
  };
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
    if (error.kind === 'http' && error.status === 429) throw new TutorMarketplaceClientError('limited');
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

function isMinorAmount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 500 && (value as number) <= 50_000;
}

function isMinorAmountOrZero(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 50_000;
}

function isSafeHttpsUrl(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length > maximum) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isSafeStripeCheckoutUrl(value: unknown): value is string {
  return isSafeHttpsUrl(value, 2000) && new URL(value).hostname === 'checkout.stripe.com';
}

function isSafeStripeConnectUrl(value: unknown): value is string {
  return isSafeHttpsUrl(value, 2000) && new URL(value).hostname === 'connect.stripe.com';
}
