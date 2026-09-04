import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import {
  getOwnTutorApplication,
  isTutorApplicationDraftValid,
  parseTutorApplication,
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
