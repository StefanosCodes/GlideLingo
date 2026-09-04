import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import {
  getOwnTutorApplication,
  isTutorApplicationDraftValid,
  parseTutorApplication,
  parseTutorProfile,
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
