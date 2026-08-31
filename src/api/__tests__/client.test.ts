import { afterEach, expect, jest, test } from '@jest/globals';

import { getJson, postJson } from '@/api/client';
import { setApiAccessTokenProvider } from '@/api/auth-token';

const fetchMock = jest.spyOn(global, 'fetch');

afterEach(() => {
  fetchMock.mockReset();
});

test('POST attaches the current bearer and JSON content headers across an account switch', async () => {
  let currentToken = 'first-user-token';
  const cleanup = setApiAccessTokenProvider(async () => currentToken);
  fetchMock.mockImplementation(async () =>
    ({
      headers: { get: () => 'req_test' },
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }) as unknown as Response,
  );

  const request = () =>
    postJson({
      body: { message: 'hello' },
      parse: (value) => value,
      path: '/v1/lesson-tutor/turns',
    });

  await request();
  currentToken = 'second-user-token';
  await request();

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    'http://localhost:8123/v1/lesson-tutor/turns',
    expect.objectContaining({
      body: JSON.stringify({ message: 'hello' }),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer first-user-token',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    'http://localhost:8123/v1/lesson-tutor/turns',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer second-user-token' }),
    }),
  );

  cleanup();
});

test('GET also attaches the current bearer without a content header', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'current-user-token');
  fetchMock.mockImplementation(async () =>
    ({
      headers: { get: () => null },
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'ready' }),
    }) as unknown as Response,
  );

  await getJson({
    parse: (value) => value,
    path: '/health/ready',
  });

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:8123/health/ready',
    expect.objectContaining({
      body: undefined,
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer current-user-token',
      },
      method: 'GET',
    }),
  );
  cleanup();
});
