import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserSessionTelemetryHook,
  registerProductionSessionTelemetry,
  SessionApi,
  setSessionTelemetryHook,
  type SessionTelemetryEvent,
} from '@/infrastructure/api/SessionApi';

const actorId = '00000000-0000-4000-8000-000000000001';
const otherActorId = '00000000-0000-4000-8000-000000000002';
const safeUser = (overrides: Record<string, unknown> = {}) => ({
  id: actorId,
  first_name: 'Ada',
  last_name: 'Lovelace',
  role: 'GENERAL',
  default_instrument: null,
  ...overrides,
});
const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('SessionApi cookie client', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setSessionTelemetryHook();
  });

  it('uses only relative same-origin credentialed requests and never stores token or user authority', async () => {
    const setLocal = vi.spyOn(window.localStorage, 'setItem');
    const setSession = vi.spyOn(window.sessionStorage, 'setItem');
    const fetcher = vi.fn().mockResolvedValue(json({
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: safeUser(),
    }));
    const api = new SessionApi(fetcher as typeof fetch);

    await expect(api.login('access-code')).resolves.toMatchObject({ user: { firstName: 'Ada' } });
    expect(fetcher).toHaveBeenCalledWith('/api/session/login', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ accessCode: 'access-code' }),
    }));
    expect(setLocal).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('hydrates reload identity exclusively through current-user', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ user: safeUser({ first_name: 'Server' }) }));
    await expect(new SessionApi(fetcher as typeof fetch).currentUser()).resolves.toMatchObject({ firstName: 'Server' });
    expect(fetcher).toHaveBeenCalledWith('/api/session/current-user', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
  });

  it('shares refresh, keeps one operation ID across bounded transient retries, and retries the request once', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let refreshAttempt = 0;
    const fetcher = vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (url === '/api/session/users' && fetcher.mock.calls.filter(([value]) => value === url).length <= 2) return Promise.resolve(json({}, 401));
      if (url === '/api/session/refresh') {
        refreshAttempt++;
        return Promise.resolve(refreshAttempt === 1 ? json({}, 503) : json({ expiresAt: '2099-01-01T00:00:00Z' }));
      }
      return Promise.resolve(json({ users: [] }));
    });
    const api = new SessionApi(fetcher as typeof fetch, { sleep, random: () => 0 });

    await expect(Promise.all([api.users(), api.users()])).resolves.toEqual([[], []]);
    const refreshCalls = fetcher.mock.calls.filter(([url]) => url === '/api/session/refresh');
    expect(refreshCalls).toHaveLength(2);
    expect(new Headers(refreshCalls[0][1]?.headers).get('x-piba-operation-id')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(new Headers(refreshCalls[1][1]?.headers).get('x-piba-operation-id')).toBe(new Headers(refreshCalls[0][1]?.headers).get('x-piba-operation-id'));
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it('aborts each hanging refresh attempt, retries only the bounded count, and emits safe timeout telemetry', async () => {
    const events: SessionTelemetryEvent[] = [];
    setSessionTelemetryHook((event) => events.push(event));
    const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (url !== '/api/session/refresh') return Promise.resolve(json({}, 401));
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const api = new SessionApi(fetcher as typeof fetch, { refreshTimeoutMs: 2, sleep: async () => undefined, random: () => 0 });

    await expect(api.currentUser()).rejects.toThrow('Secure session request failed');
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/session/refresh')).toHaveLength(3);
    expect(events).toContainEqual(expect.objectContaining({ operation: 'refresh', outcome: 'failure', failureClass: 'timeout', attempts: 3 }));
    expect(JSON.stringify(events)).not.toContain(actorId);
  });

  it('posts only the bounded telemetry contract and never throws into browser flows', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'));
    const hook = createBrowserSessionTelemetryHook(fetcher as typeof fetch);

    expect(() => hook({
      operation: 'refresh',
      outcome: 'failure',
      durationMs: 123.6,
      failureClass: 'timeout',
      attempts: 3,
      token: 'must-not-be-sent',
      accessCode: 'must-not-be-sent',
    } as SessionTelemetryEvent & { accessCode: string; token: string })).not.toThrow();
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledWith('/api/session/telemetry', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'browser_session_operation',
        operation: 'refresh',
        outcome: 'failure',
        durationMs: 124,
        failureClass: 'timeout',
        attempts: 3,
      }),
      keepalive: true,
    });
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/must-not-be-sent|accessCode|token/);

    hook({ operation: 'invalid', outcome: 'failure', durationMs: 0 } as unknown as SessionTelemetryEvent);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('executes production registration and emits refresh and logout success telemetry', async () => {
    const telemetryFetcher = vi.fn().mockResolvedValue(json({ ok: true }, 202));
    expect(registerProductionSessionTelemetry(true, telemetryFetcher as typeof fetch)).toBe(true);
    const apiFetcher = vi.fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ expiresAt: '2099-01-01T00:00:00Z' }))
      .mockResolvedValueOnce(json({ user: safeUser() }))
      .mockResolvedValueOnce(json({ ok: true }));
    const api = new SessionApi(apiFetcher as typeof fetch, { now: () => 100 });

    await expect(api.currentUser()).resolves.toMatchObject({ id: actorId });
    await expect(api.logout()).resolves.toEqual({ revoked: true });

    const telemetry = telemetryFetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(telemetry).toEqual([
      {
        event: 'browser_session_operation',
        operation: 'refresh',
        outcome: 'success',
        durationMs: 0,
        attempts: 1,
      },
      {
        event: 'browser_session_operation',
        operation: 'logout',
        outcome: 'success',
        durationMs: 0,
      },
    ]);
  });

  it.each([
    ['login', (api: SessionApi) => api.login('code')],
    ['current-user', (api: SessionApi) => api.currentUser()],
    ['logout', (api: SessionApi) => api.logout()],
  ])('bounds a nonsettling %s request with the default request deadline', async (_name, invoke) => {
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const api = new SessionApi(fetcher as typeof fetch, { requestTimeoutMs: 2 });

    const result = invoke(api);
    if (_name === 'logout') await expect(result).resolves.toEqual({ revoked: false });
    else await expect(result).rejects.toThrow('Secure session request failed');
  });

  it('keeps browser state untouched on logout failure and reports success only on confirmation', async () => {
    const failedApi = new SessionApi(vi.fn().mockResolvedValue(json({ error: 'failed', requestId: 'request-7' }, 503)) as typeof fetch);
    await expect(failedApi.logout()).resolves.toEqual({ revoked: false, requestId: 'request-7' });
    const successApi = new SessionApi(vi.fn().mockResolvedValue(json({ ok: true, requestId: 'request-8' })) as typeof fetch);
    await expect(successApi.logout()).resolves.toEqual({ revoked: true, requestId: 'request-8' });
  });

  it('single-flights logout and aborts an older logout before a newer login can establish its cookie', async () => {
    const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (url === '/api/session/login') {
        return Promise.resolve(json({ expiresAt: '2099-01-01T00:00:00Z', user: safeUser() }));
      }
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const api = new SessionApi(fetcher as typeof fetch);
    const firstLogout = api.logout();
    const secondLogout = api.logout();
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/session/logout')).toHaveLength(1);

    await expect(api.login('new-session')).resolves.toMatchObject({ user: { firstName: 'Ada' } });
    await expect(Promise.all([firstLogout, secondLogout])).resolves.toEqual([
      { revoked: false },
      { revoked: false },
    ]);

    const newLogout = api.logout();
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/session/logout')).toHaveLength(2);
    await api.login('newer-session');
    await expect(newLogout).resolves.toEqual({ revoked: false });
  });

  it('reuses a caller-owned create-user UUID after an ambiguous lost response', async () => {
    const operationId = '00000000-0000-4000-8000-000000000011';
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(json({ user: safeUser({ id: otherActorId }), accessCode: 'generated-code' }));
    const api = new SessionApi(fetcher as typeof fetch);
    const input = { firstName: 'Grace', lastName: 'Hopper', role: 'GENERAL' as const };

    await expect(api.createUser(input, operationId)).rejects.toThrow();
    await expect(api.createUser(input, operationId)).resolves.toMatchObject({ accessCode: 'generated-code' });
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('idempotency-key'))).toEqual([operationId, operationId]);
  });

  it.each([
    { expiresAt: '2099-01-01T00:00:00Z', user: safeUser({ role: 'ADMIN' }) },
    { token: 'must-never-reach-js', expiresAt: '2099-01-01T00:00:00Z', user: safeUser() },
  ])('rejects malformed session payloads and attempts confirmed revocation', async (payload) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(payload))
      .mockResolvedValueOnce(json({ ok: true }));
    await expect(new SessionApi(fetcher as typeof fetch).login('code')).rejects.toThrow('Secure session request failed');
    expect(fetcher).toHaveBeenLastCalledWith('/api/session/logout', expect.objectContaining({ credentials: 'same-origin' }));
  });
});
