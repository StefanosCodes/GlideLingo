import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import {
  getOwnTutorApplication,
  isTutorApplicationDraftValid,
  parseCalendarConnection,
  parseCalendarOAuthStart,
  parseMarketplaceConversation,
  parseMarketplaceMessage,
  parseMarketplaceMessagePage,
  parseMarketplaceMessageReport,
  parseMarketplaceBooking,
  parseMarketplaceLearningContext,
  parseTutorApplication,
  parseTutorProfile,
  parseTutorSlots,
  TutorMarketplaceClientError,
} from '@/features/tutor-marketplace/api';

const fetchMock = jest.spyOn(global, 'fetch');

afterEach(() => {
  fetchMock.mockReset();
});

const validApplication = {
  application_id: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
  status: 'draft',
  version: 1,
  headline: 'Patient conversation tutor',
  biography: 'I help adults build confidence through practical conversation.',
  time_zone: 'America/Chicago',
  languages: ['el', 'en'],
  specialties: ['Conversation'],
  submitted_at: null,
  reviewed_at: null,
  decision_reason: null,
};

describe('calendar and slot response boundaries', () => {
  test('preserves explicit Google freshness without accepting event content', () => {
    expect(parseTutorSlots({
      tutor_id: '2382f687-0ca0-4340-8e78-21ba32912869',
      time_zone: 'America/Chicago', source: 'manual+google', freshness: 'stale', slots: [],
    })).toMatchObject({ source: 'manual+google', freshness: 'stale' });
    expect(parseTutorSlots({
      tutor_id: '2382f687-0ca0-4340-8e78-21ba32912869',
      time_zone: 'America/Chicago', source: 'google-event', freshness: 'current', slots: [],
    })).toBeNull();
    expect(parseCalendarConnection({
      status: 'reconnect_required', freshness: 'reconnect_required',
      last_refreshed_at: null, safe_failure_code: 'revoked',
    })).toMatchObject({ status: 'reconnect_required', safeFailureCode: 'revoked' });
  });

  test('accepts only the reviewed Google authorization origin', () => {
    const valid = {
      authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=freebusy',
      expires_at: '2026-09-04T12:10:00Z',
    };
    expect(parseCalendarOAuthStart(valid)).not.toBeNull();
    expect(parseCalendarOAuthStart({ ...valid, authorization_url: 'https://attacker.test/' })).toBeNull();
  });
});

describe('messaging response boundaries', () => {
  const message = {
    message_id: '2382f687-0ca0-4340-8e78-21ba32912869',
    kind: 'user', sender_role: 'learner', body: '<script>alert(1)</script>',
    is_own: true, created_at: '2026-09-04T12:10:00Z',
  };

  test('maps only participant-safe conversation and text message projections', () => {
    expect(parseMarketplaceConversation({
      conversation_id: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
      tutor_id: '7da10dbc-0546-4f74-a751-3cad7b5058b3', participant_role: 'learner',
      state: 'open', updated_at: '2026-09-04T12:10:00Z',
    })).toMatchObject({ participantRole: 'learner', state: 'open' });
    expect(parseMarketplaceMessage(message)).toMatchObject({ body: message.body, isOwn: true });
    expect(parseMarketplaceMessagePage({ items: [message], next_cursor: null })?.items).toHaveLength(1);
  });

  test('rejects executable message kinds, unbounded pages, and private actor identifiers', () => {
    expect(parseMarketplaceMessage({ ...message, kind: 'html' })).toBeNull();
    expect(parseMarketplaceMessagePage({ items: Array(101).fill(message), next_cursor: null })).toBeNull();
    expect(parseMarketplaceConversation({
      conversation_id: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
      tutor_id: '7da10dbc-0546-4f74-a751-3cad7b5058b3', participant_role: 'learner',
      state: 'open', updated_at: '2026-09-04T12:10:00Z', actor_ref: 'private',
    })).not.toHaveProperty('actorRef');
  });

  test('requires bounded report context', () => {
    expect(parseMarketplaceMessageReport({
      report_id: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb',
      conversation_id: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', message_id: message.message_id,
      reason: 'unsafe', details: null, status: 'open', created_at: '2026-09-04T12:10:00Z',
      messages: [message],
    })).toMatchObject({ reason: 'unsafe', messages: [{ body: message.body }] });
  });
});

describe('booking response boundary', () => {
  const booking = {
    booking_id: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
    tutor_id: '7da10dbc-0546-4f74-a751-3cad7b5058b3', role: 'learner',
    state: 'payment_pending', starts_at: '2026-09-05T12:00:00Z',
    ends_at: '2026-09-05T12:25:00Z', hold_expires_at: '2026-09-04T12:10:00Z',
    amount_minor: 2500, currency: 'USD', commission_amount_minor: 500,
    tutor_amount_minor: 0, checkout_url: 'https://checkout.stripe.com/c/pay/reviewed123',
    meeting_url: null, ics: null, schedule_version: 1, money_state: null,
    dispute_deadline_at: null,
  };

  test('accepts the participant projection without provider identifiers', () => {
    expect(parseMarketplaceBooking(booking)).toMatchObject({ state: 'payment_pending', amountMinor: 2500 });
    expect(parseMarketplaceBooking({ ...booking, checkout_url: 'https://attacker.test/pay' })).toBeNull();
    expect(parseMarketplaceBooking({ ...booking, state: 'confirmed' })).toBeNull();
  });
});

describe('learning context response boundary', () => {
  const context = {
    booking_id: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
    role: 'tutor', consent_state: 'granted', access_expires_at: '2026-09-12T12:25:00Z',
    brief: {
      selected_goal: 'Practice a family introduction', language_code: 'el',
      course_id: null, course_title: null,
      capabilities: ['Introduce myself'], review_focus: ['Family vocabulary'],
    },
    follow_up: null,
  };

  test('accepts learner-selected no-course context without progress authority', () => {
    expect(parseMarketplaceLearningContext(context)).toMatchObject({
      role: 'tutor', consentState: 'granted',
      brief: { courseId: null, selectedGoal: 'Practice a family introduction' },
    });
    expect(parseMarketplaceLearningContext({ ...context, mastery: 1 })).not.toHaveProperty('mastery');
  });

  test('requires a hidden brief after revocation or expiry', () => {
    expect(parseMarketplaceLearningContext({
      ...context, consent_state: 'revoked', access_expires_at: null, brief: null,
    })).toMatchObject({ consentState: 'revoked', brief: null });
    expect(parseMarketplaceLearningContext({ ...context, consent_state: 'revoked' })).toBeNull();
  });
});

describe('parseTutorProfile', () => {
  const validProfile = {
    tutor_id: '2382f687-0ca0-4340-8e78-21ba32912869',
    application_id: validApplication.application_id,
    application_status: 'approved',
    version: 1,
    headline: validApplication.headline,
    biography: validApplication.biography,
    time_zone: validApplication.time_zone,
    is_published: false,
    payout_ready: false,
    publication_blockers: ['payout_not_ready'],
    credential: {
      credential_id: '7da10dbc-0546-4f74-a751-3cad7b5058b3',
      version: 1,
      credential_type: 'certificate',
      title: 'Adult language teaching certificate',
      issuer: 'Example Institute',
      verification_status: 'unverified',
      verification_reason: null,
      reviewed_at: null,
    },
    offering: {
      offering_id: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb',
      version: 1,
      title: '25-minute conversation lesson',
      duration_minutes: 25,
      amount_minor: 2500,
      currency: 'USD',
      state: 'draft',
      commission_policy: {
        policy_id: '10000000-0000-4000-8000-000000000001',
        policy_type: 'commission',
        version: 1,
        commission_basis_points: 2000,
        cancellation_cutoff_hours: null,
        dispute_window_hours: null,
        effective_at: '2026-09-04T00:00:00Z',
      },
      cancellation_policy: {
        policy_id: '20000000-0000-4000-8000-000000000001',
        policy_type: 'cancellation',
        version: 1,
        commission_basis_points: null,
        cancellation_cutoff_hours: 12,
        dispute_window_hours: 24,
        effective_at: '2026-09-04T00:00:00Z',
      },
    },
  };

  test('accepts the private supply projection and immutable policy snapshots', () => {
    expect(parseTutorProfile(validProfile)).toMatchObject({
      applicationStatus: 'approved',
      payoutReady: false,
      credential: { verificationStatus: 'unverified' },
      offering: {
        state: 'draft',
        commissionPolicy: { commissionBasisPoints: 2000 },
        cancellationPolicy: { cancellationCutoffHours: 12, disputeWindowHours: 24 },
      },
    });
  });

  test.each([
    { ...validProfile, payout_ready: 'false' },
    { ...validProfile, publication_blockers: ['unknown'] },
    { ...validProfile, offering: { ...validProfile.offering, state: 'paid' } },
    { ...validProfile, offering: { ...validProfile.offering, currency: 'EUR' } },
    {
      ...validProfile,
      offering: {
        ...validProfile.offering,
        commission_policy: {
          ...validProfile.offering.commission_policy,
          cancellation_cutoff_hours: 12,
        },
      },
    },
  ])('rejects unsafe or inconsistent private supply responses', (responseValue) => {
    expect(parseTutorProfile(responseValue)).toBeNull();
  });
});

describe('parseTutorApplication', () => {
  test('accepts and maps the bounded API contract', () => {
    expect(parseTutorApplication(validApplication)).toEqual({
      applicationId: validApplication.application_id,
      status: 'draft',
      version: 1,
      headline: validApplication.headline,
      biography: validApplication.biography,
      timeZone: validApplication.time_zone,
      languages: ['el', 'en'],
      specialties: ['Conversation'],
      submittedAt: null,
      reviewedAt: null,
      decisionReason: null,
    });
  });

  test.each([
    { ...validApplication, status: 'pending' },
    { ...validApplication, version: 0 },
    { ...validApplication, languages: [] },
    { ...validApplication, application_id: 'not-a-uuid' },
    { ...validApplication, unexpected: 'field', headline: '' },
  ])('rejects malformed responses', (response) => {
    expect(parseTutorApplication(response)).toBeNull();
  });
});

describe('tutor application request boundary', () => {
  test('requires bounded fields, language codes, and an IANA time zone', () => {
    const validDraft = {
      headline: validApplication.headline,
      biography: validApplication.biography,
      timeZone: validApplication.time_zone,
      languages: validApplication.languages,
      specialties: validApplication.specialties,
    };
    expect(isTutorApplicationDraftValid(validDraft)).toBe(true);
    expect(isTutorApplicationDraftValid({ ...validDraft, timeZone: 'Chicago' })).toBe(false);
    expect(isTutorApplicationDraftValid({ ...validDraft, languages: ['English'] })).toBe(false);
    expect(isTutorApplicationDraftValid({ ...validDraft, specialties: ['x'] })).toBe(false);
  });

  test('distinguishes an absent application from a server with no marketplace route', async () => {
    const cleanupToken = setApiAccessTokenProvider(async () => 'test-token');
    try {
      fetchMock.mockResolvedValueOnce(
        response(404, { detail: 'Not Found' }),
      );
      await expect(getOwnTutorApplication()).rejects.toMatchObject({
        kind: 'unavailable',
      } satisfies Partial<TutorMarketplaceClientError>);

      fetchMock.mockResolvedValueOnce(
        response(404, {
          error: {
            code: 'tutor_application_not_found',
            message: 'The tutor application could not be found.',
            request_id: 'req_test',
          },
        }),
      );
      await expect(getOwnTutorApplication()).rejects.toMatchObject({
        kind: 'not-found',
      } satisfies Partial<TutorMarketplaceClientError>);
    } finally {
      cleanupToken();
    }
  });
});

function response(status: number, body: unknown): Response {
  return {
    headers: { get: () => 'req_test' },
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
