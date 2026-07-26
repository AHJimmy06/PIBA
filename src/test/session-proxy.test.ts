import { describe, expect, it, vi } from 'vitest';
import { sessionProxy } from '../../api/session';

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  PIBA_PROXY_SECRET: 'proxy-secret',
};
const request = (
  action: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
) => new Request(`https://app.example/api/session/${action}`, {
  method: options.method ?? 'POST',
  headers: {
    host: 'app.example',
    origin: 'https://app.example',
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...options.headers,
  },
  body: options.body,
});
const upstream = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers });
const run = (
  input: Request,
  fetcher: typeof fetch,
  overrides: NodeJS.ProcessEnv = {},
  dependencies: { logger?: (entry: unknown) => void; upstreamTimeoutMs?: number } = {},
) => sessionProxy(input, {
  fetch: fetcher,
  env: { ...env, ...overrides },
  now: () => Date.parse('2026-01-01T00:00:00Z'),
  id: () => 'proxy-request-1',
  logger: dependencies.logger ?? (() => undefined),
  upstreamTimeoutMs: dependencies.upstreamTimeoutMs,
});

describe('session proxy', () => {
  it.each([
    ['login', 'POST', 'session-login'],
    ['refresh', 'POST', 'session-refresh'],
    ['logout', 'POST', 'session-logout'],
    ['current-user', 'GET', 'session-profile'],
    ['profile', 'POST', 'session-profile'],
    ['users', 'GET', 'session-users'],
    ['users', 'POST', 'session-users'],
  ])('routes %s %s only to its fixed upstream', async (action, method, expected) => {
    const fetcher = vi.fn().mockResolvedValue(upstream(action === 'logout' ? { ok: true } : {}));
    const headers: Record<string, string> = action === 'login' ? {} : { cookie: '__Host-piba_session=signed-token' };
    await run(request(action, { method, headers }), fetcher as typeof fetch);
    const [url] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://project.supabase.co/functions/v1/${expected}`);
  });

  it('rejects unknown and nested actions without making an upstream request', async () => {
    const fetcher = vi.fn();
    expect((await run(request('https://attacker.example'), fetcher as typeof fetch)).status).toBe(404);
    const nested = new Request('https://app.example/api/session/users/extra', { headers: { host: 'app.example' } });
    expect((await run(nested, fetcher as typeof fetch)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts the fixed Vercel catch-all rewrite destination', async () => {
    const fetcher = vi.fn().mockResolvedValue(upstream({ expiresAt: '2026-01-01T01:00:00Z', token: 'token' }));
    const rewritten = new Request('https://app.example/api/session?action=login', {
      method: 'POST',
      headers: { host: 'app.example', origin: 'https://app.example' },
    });
    expect((await run(rewritten, fetcher as typeof fetch)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('enforces methods, same-origin Origin/Host, and body limits before upstream work', async () => {
    const fetcher = vi.fn();
    expect((await run(request('login', { method: 'GET' }), fetcher as typeof fetch)).status).toBe(405);
    expect((await run(request('login', { headers: { origin: 'https://attacker.example' } }), fetcher as typeof fetch)).status).toBe(403);
    expect((await run(request('login', { headers: { host: 'attacker.example' } }), fetcher as typeof fetch)).status).toBe(403);
    expect((await run(request('login', { body: JSON.stringify({ value: 'x'.repeat(1100) }) }), fetcher as typeof fetch)).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts and logs only sanitized same-origin browser telemetry without upstream work', async () => {
    const entries: unknown[] = [];
    const fetcher = vi.fn();
    const response = await run(request('telemetry', {
      body: JSON.stringify({
        event: 'browser_session_operation',
        operation: 'refresh',
        outcome: 'failure',
        durationMs: 125,
        failureClass: 'timeout',
        attempts: 3,
      }),
      headers: { 'x-forwarded-for': '198.51.100.10' },
    }), fetcher as typeof fetch, {}, { logger: (entry) => entries.push(entry) });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, requestId: 'proxy-request-1' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(entries).toEqual([{
      request_id: 'proxy-request-1',
      event: 'browser_session_operation',
      operation: 'refresh',
      outcome: 'failure',
      duration_ms: 125,
      failure_class: 'timeout',
      attempts: 3,
    }]);
  });

  it('accepts and logs a sanitized browser success event', async () => {
    const entries: unknown[] = [];
    const response = await run(request('telemetry', {
      body: JSON.stringify({
        event: 'browser_session_operation',
        operation: 'logout',
        outcome: 'success',
        durationMs: 12,
      }),
      headers: { 'x-forwarded-for': '198.51.100.13' },
    }), vi.fn() as typeof fetch, {}, { logger: (entry) => entries.push(entry) });

    expect(response.status).toBe(202);
    expect(entries).toEqual([{
      request_id: 'proxy-request-1',
      event: 'browser_session_operation',
      operation: 'logout',
      outcome: 'success',
      duration_ms: 12,
    }]);
    expect(JSON.stringify(entries)).not.toMatch(/token|cookie|code|user/i);
  });

  it('rejects malformed, credential-bearing, oversized, and cross-origin telemetry', async () => {
    const entries: unknown[] = [];
    const fetcher = vi.fn();
    const telemetry = (body: string, headers: Record<string, string> = {}) => run(
      request('telemetry', { body, headers: { 'x-forwarded-for': '198.51.100.11', ...headers } }),
      fetcher as typeof fetch,
      {},
      { logger: (entry) => entries.push(entry) },
    );
    const valid = {
      event: 'browser_session_operation',
      operation: 'logout',
      outcome: 'failure',
      durationMs: 1,
      failureClass: 'dependency',
    };

    expect((await telemetry(JSON.stringify({ ...valid, token: 'secret' }))).status).toBe(400);
    expect((await telemetry(JSON.stringify({ ...valid, accessCode: '1234' }))).status).toBe(400);
    expect((await telemetry('{invalid-json')).status).toBe(400);
    expect((await telemetry(JSON.stringify(valid), { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await telemetry(JSON.stringify({ ...valid, padding: 'x'.repeat(600) }))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it('rate-limits browser telemetry by opaque client identity', async () => {
    const payload = JSON.stringify({
      event: 'browser_session_operation',
      operation: 'offline',
      outcome: 'failure',
      durationMs: 0,
      failureClass: 'offline',
    });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt++) {
      statuses.push((await run(request('telemetry', {
        body: payload,
        headers: { 'x-forwarded-for': '198.51.100.12' },
      }), vi.fn() as typeof fetch)).status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(202));
    expect(statuses[20]).toBe(429);
  });

  it('forwards only allowlisted headers and replaces spoofed client identity with an opaque trusted key', async () => {
    const fetcher = vi.fn().mockResolvedValue(upstream({ users: [] }));
    await run(request('users', {
      method: 'GET',
      headers: {
        cookie: '__Host-piba_session=signed-token',
        authorization: 'Bearer attacker',
        'x-piba-proxy-secret': 'attacker',
        'x-piba-client-key': 'attacker-controlled',
        'x-forwarded-for': '203.0.113.1',
        'idempotency-key': 'operation-id',
      },
    }), fetcher as typeof fetch);
    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(Object.fromEntries(headers)).toEqual({
      apikey: 'anon-key',
      authorization: 'Bearer signed-token',
      'idempotency-key': 'operation-id',
      'x-piba-client-key': expect.stringMatching(/^[0-9a-f]{64}$/),
      'x-piba-proxy-secret': 'proxy-secret',
    });
    expect(headers.get('x-piba-client-key')).not.toBe('attacker-controlled');
    expect(headers.has('x-forwarded-for')).toBe(false);
  });

  it('prefers a configured modern publishable key and otherwise uses legacy anon', async () => {
    const modernKey = 'sb_publishable_modern-key';
    const keys: Array<string | null> = [];
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('apikey'));
      return Promise.resolve(upstream({}));
    });

    await run(request('login'), fetcher as typeof fetch, { SUPABASE_PUBLISHABLE_KEY: modernKey });
    await run(request('login'), fetcher as typeof fetch);

    expect(keys).toEqual([modernKey, 'anon-key']);
  });

  it.each(['', 'publishable-key', ' sb_publishable_key', 'sb_publishable_'])(
    'fails closed for malformed configured publishable key %j',
    async (publishableKey) => {
      const fetcher = vi.fn();
      const response = await run(request('login'), fetcher as typeof fetch, {
        SUPABASE_PUBLISHABLE_KEY: publishableKey,
      });

      expect(response.status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('separates trusted Vercel clients and uses an observable shared fallback when identity is absent', async () => {
    const keys: Array<string | null> = [];
    const entries: unknown[] = [];
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('x-piba-client-key'));
      return Promise.resolve(upstream({}));
    });
    await run(request('login', { headers: { 'x-forwarded-for': '203.0.113.1' } }), fetcher as typeof fetch, {}, { logger: (entry) => entries.push(entry) });
    await run(request('login', { headers: { 'x-forwarded-for': '203.0.113.2' } }), fetcher as typeof fetch, {}, { logger: (entry) => entries.push(entry) });
    await run(request('login'), fetcher as typeof fetch, {}, { logger: (entry) => entries.push(entry) });

    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBeNull();
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ client_identity: 'trusted' }),
      expect.objectContaining({ client_identity: 'anonymous' }),
    ]));
  });

  it('strips login and refresh tokens and sets a bounded host-only HttpOnly cookie', async () => {
    for (const action of ['login', 'refresh']) {
      const fetcher = vi.fn().mockResolvedValue(upstream({
        token: 'signed-token',
        expiresAt: '2026-01-01T12:00:00.000Z',
        ...(action === 'login' ? { user: { id: 'safe' } } : {}),
      }));
      const response = await run(request(action, {
        headers: action === 'refresh' ? { cookie: '__Host-piba_session=old-token' } : {},
      }), fetcher as typeof fetch);
      expect(await response.json()).not.toHaveProperty('token');
      expect(response.headers.get('set-cookie')).toBe('__Host-piba_session=signed-token; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800');
      expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    }
  });

  it.each(['login', 'refresh'])('strips all session credentials from failed %s responses', async (action) => {
    const response = await run(
      request(action, {
        headers: action === 'refresh' ? { cookie: '__Host-piba_session=old-token' } : {},
      }),
      vi.fn().mockResolvedValue(upstream({
        error: 'upstream failure',
        token: 'top-level-token',
        access_token: 'access-token',
        session: { token: 'session-token' },
        nested: { refreshToken: 'refresh-token', safe: true },
      }, 401)) as typeof fetch,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'upstream failure',
      nested: { safe: true },
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('clears the cookie only after confirmed logout revocation', async () => {
    const success = await run(
      request('logout', { headers: { cookie: '__Host-piba_session=token' } }),
      vi.fn().mockResolvedValue(upstream({ ok: true })) as typeof fetch,
    );
    expect(success.headers.get('set-cookie')).toContain('Max-Age=0');

    for (const response of [upstream({ error: 'failed' }, 503), upstream({ ok: false })]) {
      const failed = await run(
        request('logout', { headers: { cookie: '__Host-piba_session=token' } }),
        vi.fn().mockResolvedValue(response) as typeof fetch,
      );
      expect(failed.headers.get('set-cookie')).toBeNull();
    }
  });

  it('sets no-store headers on every response and varies protected data by cookie', async () => {
    const response = await run(
      request('current-user', { method: 'GET', headers: { cookie: '__Host-piba_session=token' } }),
      vi.fn().mockResolvedValue(upstream({ user: {} })) as typeof fetch,
    );
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('aborts a nonsettling upstream independently and logs exactly one safe timeout completion', async () => {
    const entries: unknown[] = [];
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const response = await run(request('login'), fetcher as typeof fetch, {}, {
      upstreamTimeoutMs: 2,
      logger: (entry) => entries.push(entry),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Invalid request', requestId: 'proxy-request-1' });
    expect(entries).toEqual([expect.objectContaining({
      request_id: 'proxy-request-1',
      route: 'login',
      method: 'POST',
      status: 503,
      outcome: 'failure',
      failure_class: 'timeout',
    })]);
    expect(JSON.stringify(entries)).not.toMatch(/cookie|token|203\.0\.113/);
  });
});
