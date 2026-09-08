import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request, __resetHttpState } from '../../src/lib/http';
import { setTokens, getTokens, clearTokens } from '../../src/lib/tokens';
import { ApiError } from '../../src/lib/errors';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const apiError = (status: number, code: string): Response =>
  json(status, { error: { code, message: 'nope' } });

const tokenPair = (suffix: string) => ({
  accessToken: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
  tokenType: 'Bearer',
  expiresIn: 600,
  user: { id: 'cp_usr_1', email: 'a@b.co', createdAt: '2026-01-01T00:00:00.000Z' },
});

describe('http', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.test';
    __resetHttpState();
    clearTokens();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends the API version and attaches the bearer token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });
    fetchMock.mockResolvedValueOnce(json(200, { data: [], nextCursor: null }));

    await request('/devices');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/v1/devices');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('serialises the query string, dropping undefined values', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });
    fetchMock.mockResolvedValueOnce(json(200, { data: [], nextCursor: null }));

    await request('/devices', { query: { limit: 100, cursor: undefined, includeRevoked: false } });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('includeRevoked')).toBe('false');
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('returns undefined for 204 rather than trying to parse a body', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(request('/share-sessions/x/leave', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('refreshes once on token_expired and retries the original request', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });

    fetchMock
      .mockResolvedValueOnce(apiError(401, 'token_expired'))
      .mockResolvedValueOnce(json(200, tokenPair('2')))
      .mockResolvedValueOnce(json(200, { data: [], nextCursor: null }));

    await request('/devices');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/v1/auth/refresh');
    // The retry carries the rotated access token, and the new pair is stored.
    expect((fetchMock.mock.calls[2][1].headers as Record<string, string>).Authorization).toBe(
      'Bearer access-2',
    );
    expect(getTokens()?.refreshToken).toBe('refresh-2');
  });

  it('issues exactly one refresh for concurrent 401s', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });

    // Two concurrent refreshes would make the second a *reuse*, and the server
    // would revoke the whole family (ADR-004). This is the guard against that.
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) return Promise.resolve(json(200, tokenPair('2')));
      const auth = 'Bearer access-1';
      const calledWith = fetchMock.mock.calls.at(-1)?.[1]?.headers?.Authorization;
      return Promise.resolve(
        calledWith === auth ? apiError(401, 'token_expired') : json(200, { ok: true }),
      );
    });

    await Promise.all([request('/devices'), request('/share-sessions'), request('/auth/me')]);

    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('wipes tokens and does not retry on token_reused', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });
    fetchMock.mockResolvedValueOnce(apiError(401, 'token_reused'));

    await expect(request('/devices')).rejects.toMatchObject({ code: 'token_reused' });

    expect(getTokens()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the session when the refresh itself is rejected', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 600 });

    fetchMock
      .mockResolvedValueOnce(apiError(401, 'token_expired'))
      .mockResolvedValueOnce(apiError(401, 'unauthenticated'));

    await expect(request('/devices')).rejects.toBeInstanceOf(ApiError);
    expect(getTokens()).toBeNull();
  });

  it('surfaces error code, details and Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'invalid_request',
            message: 'Request validation failed.',
            details: [{ path: 'password', message: 'must be at least 12 characters' }],
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } },
      ),
    );

    const err = await request('/auth/signup', { method: 'POST', body: {}, auth: false }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.code).toBe('invalid_request');
    expect(apiErr.detailFor('password')).toBe('must be at least 12 characters');
    expect(apiErr.retryAfter).toBe(30);
    expect(apiErr.isTerminal).toBe(true);
  });

  it('degrades a non-JSON failure to a typed internal error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));

    await expect(request('/protocol', { auth: false })).rejects.toMatchObject({
      code: 'internal',
      status: 502,
    });
  });

  it('reports a transport failure as a network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(request('/protocol', { auth: false })).rejects.toMatchObject({ code: 'network' });
  });

  it('throws a clear error when the API URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    await expect(request('/protocol', { auth: false })).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });
});
