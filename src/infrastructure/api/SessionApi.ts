import type { Role, User } from '@/core/domain/entities/User';

export const SESSION_CLEARED_EVENT = 'piba-session-cleared';
export const SESSION_RECOVERABLE_EVENT = 'piba-session-recoverable';

type SafeUser = {
  id: string;
  first_name: string;
  last_name: string;
  role: Role;
  default_instrument: string | null;
};

const SAFE_USER_KEYS = new Set(['id', 'first_name', 'last_name', 'role', 'default_instrument']);
const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);

export type BrowserSession = { expiresAt: string; user: User };
export type LogoutResult = { revoked: boolean; requestId?: string };
export type SessionTelemetryEvent = {
  operation: 'refresh' | 'offline' | 'logout';
  outcome: 'success' | 'failure';
  durationMs: number;
  failureClass?: 'auth' | 'timeout' | 'offline' | 'rate_limit' | 'dependency' | 'invalid_response';
  attempts?: number;
};

type TelemetryHook = (event: SessionTelemetryEvent) => void;
let telemetryHook: TelemetryHook = () => undefined;
export const setSessionTelemetryHook = (hook?: TelemetryHook) => {
  telemetryHook = hook ?? (() => undefined);
};

class SessionRequestError extends Error {
  readonly status?: number;
  readonly failureClass: NonNullable<SessionTelemetryEvent['failureClass']>;
  readonly requestId?: string;

  constructor(
    message: string,
    status?: number,
    failureClass: NonNullable<SessionTelemetryEvent['failureClass']> = 'dependency',
    requestId?: string,
  ) {
    super(message);
    this.status = status;
    this.failureClass = failureClass;
    this.requestId = requestId;
  }
}

const emit = (event: SessionTelemetryEvent) => {
  try {
    telemetryHook(Object.freeze({ ...event }));
  } catch {
    // Telemetry is best-effort and must never alter session behavior.
  }
};

const toUser = (row: SafeUser): User => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  role: row.role,
  defaultInstrument: row.default_instrument ?? undefined,
});

const isSafeUser = (value: unknown): value is SafeUser => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === SAFE_USER_KEYS.size
    && Object.keys(row).every((key) => SAFE_USER_KEYS.has(key))
    && typeof row.id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)
    && typeof row.first_name === 'string'
    && typeof row.last_name === 'string'
    && (row.role === 'GENERAL' || row.role === 'LIDER_REPASO')
    && (row.default_instrument === null || typeof row.default_instrument === 'string');
};

const failureClass = (status?: number): NonNullable<SessionTelemetryEvent['failureClass']> => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  return 'dependency';
};

export const isTransientSessionError = (error: unknown) =>
  error instanceof SessionRequestError && error.failureClass !== 'auth' && error.failureClass !== 'invalid_response';

export class SessionApi {
  private refreshFlight: Promise<void> | null = null;
  private logoutFlight: Promise<LogoutResult> | null = null;
  private logoutController: AbortController | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly refreshTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(
    fetcher: typeof fetch = fetch,
    timing: {
      now?: () => number;
      sleep?: (milliseconds: number) => Promise<void>;
      random?: () => number;
      refreshTimeoutMs?: number;
      requestTimeoutMs?: number;
    } = {},
  ) {
    this.fetcher = fetcher;
    this.now = timing.now ?? Date.now;
    this.sleep = timing.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = timing.random ?? Math.random;
    this.refreshTimeoutMs = timing.refreshTimeoutMs ?? 5_000;
    this.requestTimeoutMs = timing.requestTimeoutMs ?? 10_000;
  }

  private async request(
    action: string,
    options: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(`/api/session/${action}`, {
        method: options.method ?? 'POST',
        credentials: 'same-origin',
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      throw new SessionRequestError(
        'Secure session request failed',
        timedOut || aborted ? 408 : undefined,
        timedOut || aborted ? 'timeout' : offline ? 'offline' : 'dependency',
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SessionRequestError('Secure session request failed', response.status, 'invalid_response');
    }
    if (!response.ok) {
      const requestId = payload && typeof payload === 'object' && typeof (payload as { requestId?: unknown }).requestId === 'string'
        ? (payload as { requestId: string }).requestId
        : undefined;
      throw new SessionRequestError('Secure session request failed', response.status, failureClass(response.status), requestId);
    }
    if (payload && typeof payload === 'object' && 'token' in payload) {
      throw new SessionRequestError('Secure session request failed', response.status, 'invalid_response');
    }
    return payload;
  }

  private async refresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = (async () => {
      const operationId = crypto.randomUUID();
      const startedAt = this.now();
      let attempts = 0;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          attempts = attempt + 1;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.refreshTimeoutMs);
          try {
            await this.request('refresh', {
              headers: { 'x-piba-operation-id': operationId },
              signal: controller.signal,
            });
            emit({ operation: 'refresh', outcome: 'success', durationMs: Math.max(0, this.now() - startedAt), attempts });
            return;
          } catch (error) {
            if (!(error instanceof SessionRequestError) || error.failureClass === 'auth' || error.failureClass === 'invalid_response') throw error;
            if (attempt === 2 || (error.status !== undefined && !TRANSIENT_STATUSES.has(error.status))) throw error;
          } finally {
            clearTimeout(timeout);
          }
          await this.sleep((100 * 2 ** attempt) + Math.floor(this.random() * 25));
        }
      } catch (error) {
        const kind = error instanceof SessionRequestError ? error.failureClass : 'dependency';
        emit({ operation: 'refresh', outcome: 'failure', durationMs: Math.max(0, this.now() - startedAt), failureClass: kind, attempts });
        if (kind === 'auth') window.dispatchEvent(new Event(SESSION_CLEARED_EVENT));
        else {
          emit({ operation: 'offline', outcome: 'failure', durationMs: 0, failureClass: kind });
          window.dispatchEvent(new CustomEvent(SESSION_RECOVERABLE_EVENT, { detail: { failureClass: kind } }));
        }
        throw error;
      }
    })().finally(() => {
      this.refreshFlight = null;
    });
    return this.refreshFlight;
  }

  private async protectedRequest(
    action: string,
    options: Parameters<SessionApi['request']>[1] = {},
    retried = false,
  ): Promise<unknown> {
    try {
      return await this.request(action, options);
    } catch (error) {
      if (!retried && error instanceof SessionRequestError && error.status === 401) {
        await this.refresh();
        return this.protectedRequest(action, options, true);
      }
      if (error instanceof SessionRequestError && error.status === 401) {
        window.dispatchEvent(new Event(SESSION_CLEARED_EVENT));
      }
      throw error;
    }
  }

  private async rejectMalformedSession(): Promise<never> {
    try {
      await this.logout();
    } catch {
      // The cookie remains when revocation cannot be confirmed.
    }
    throw new SessionRequestError('Secure session request failed', undefined, 'invalid_response');
  }

  async login(accessCode: string): Promise<BrowserSession> {
    this.logoutController?.abort();
    this.logoutController = null;
    this.logoutFlight = null;
    let data: { expiresAt?: unknown; user?: unknown } | null;
    try {
      data = await this.request('login', { body: { accessCode } }) as typeof data;
    } catch (error) {
      if (error instanceof SessionRequestError && error.failureClass === 'invalid_response') {
        return this.rejectMalformedSession();
      }
      throw error;
    }
    if (typeof data?.expiresAt !== 'string' || !isSafeUser(data.user)) return this.rejectMalformedSession();
    return { expiresAt: data.expiresAt, user: toUser(data.user) };
  }

  async currentUser(): Promise<User> {
    const data = await this.protectedRequest('current-user', { method: 'GET' }) as { user?: unknown } | null;
    if (!isSafeUser(data?.user)) return this.rejectMalformedSession();
    return toUser(data.user);
  }

  async users(): Promise<User[]> {
    const data = await this.protectedRequest('users', { method: 'GET' }) as { users?: unknown } | null;
    if (!Array.isArray(data?.users) || !data.users.every(isSafeUser)) return this.rejectMalformedSession();
    return data.users.map(toUser);
  }

  async updateProfile(user: User): Promise<User> {
    const data = await this.protectedRequest('profile', {
      body: { firstName: user.firstName, lastName: user.lastName, defaultInstrument: user.defaultInstrument },
    }) as { user?: unknown } | null;
    if (!isSafeUser(data?.user)) return this.rejectMalformedSession();
    return toUser(data.user);
  }

  async createUser(user: Omit<User, 'id' | 'accessCode'>, operationId: string): Promise<User> {
    const data = await this.protectedRequest('users', {
      headers: { 'Idempotency-Key': operationId },
      body: {
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        defaultInstrument: user.defaultInstrument,
      },
    }) as { user?: unknown; accessCode?: unknown } | null;
    if (!isSafeUser(data?.user) || typeof data.accessCode !== 'string') return this.rejectMalformedSession();
    return { ...toUser(data.user), accessCode: data.accessCode };
  }

  async logout(): Promise<LogoutResult> {
    if (this.logoutFlight) return this.logoutFlight;
    const startedAt = this.now();
    const controller = new AbortController();
    this.logoutController = controller;
    this.logoutFlight = (async () => {
      try {
        const data = await this.request('logout', { signal: controller.signal }) as { ok?: unknown; requestId?: unknown } | null;
        if (data?.ok !== true) throw new SessionRequestError('Secure session request failed', undefined, 'invalid_response');
        const result = { revoked: true, requestId: typeof data.requestId === 'string' ? data.requestId : undefined };
        emit({ operation: 'logout', outcome: 'success', durationMs: Math.max(0, this.now() - startedAt) });
        return result;
      } catch (error) {
        const kind = error instanceof SessionRequestError ? error.failureClass : 'dependency';
        emit({ operation: 'logout', outcome: 'failure', durationMs: Math.max(0, this.now() - startedAt), failureClass: kind });
        return { revoked: false, requestId: error instanceof SessionRequestError ? error.requestId : undefined };
      }
    })().finally(() => {
      if (this.logoutController === controller) {
        this.logoutController = null;
        this.logoutFlight = null;
      }
    });
    return this.logoutFlight;
  }
}

export const sessionApi = new SessionApi();
