const COOKIE_NAME = '__Host-piba_session';
const MAX_BODY_BYTES = 1024;
const MAX_TELEMETRY_BODY_BYTES = 512;
const MAX_SESSION_AGE_SECONDS = 8 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 8_000;
const TELEMETRY_RATE_LIMIT = 20;
const TELEMETRY_RATE_WINDOW_MS = 60_000;
const MAX_TELEMETRY_CLIENTS = 1_000;

type ProxyFailureClass = 'auth' | 'configuration' | 'timeout' | 'transport' | 'upstream' | 'validation';
type ProxyLog = {
  request_id: string;
  route: string;
  method: string;
  status: number;
  duration_ms: number;
  outcome: 'success' | 'failure';
  client_identity: 'trusted' | 'anonymous';
  failure_class?: ProxyFailureClass;
};

type BrowserTelemetryLog = {
  request_id: string;
  event: 'browser_session_operation';
  operation: 'refresh' | 'offline' | 'logout';
  outcome: 'success' | 'failure';
  duration_ms: number;
  failure_class?: 'auth' | 'timeout' | 'offline' | 'rate_limit' | 'dependency' | 'invalid_response';
  attempts?: number;
};

type SessionLog = ProxyLog | BrowserTelemetryLog;

type Route = {
  upstream: 'session-login' | 'session-refresh' | 'session-logout' | 'session-profile' | 'session-users';
  methods: readonly string[];
  protected: boolean;
};

const ROUTES: Readonly<Record<string, Route>> = {
  login: { upstream: 'session-login', methods: ['POST'], protected: false },
  refresh: { upstream: 'session-refresh', methods: ['POST'], protected: true },
  logout: { upstream: 'session-logout', methods: ['POST'], protected: true },
  'current-user': { upstream: 'session-profile', methods: ['GET'], protected: true },
  profile: { upstream: 'session-profile', methods: ['POST'], protected: true },
  users: { upstream: 'session-users', methods: ['GET', 'POST'], protected: true },
};

const TELEMETRY_KEYS = new Set(['event', 'operation', 'outcome', 'durationMs', 'failureClass', 'attempts']);
const TELEMETRY_OPERATIONS = new Set(['refresh', 'offline', 'logout']);
const TELEMETRY_OUTCOMES = new Set(['success', 'failure']);
const TELEMETRY_FAILURE_CLASSES = new Set(['auth', 'timeout', 'offline', 'rate_limit', 'dependency', 'invalid_response']);
const telemetryClients = new Map<string, { count: number; windowStartedAt: number }>();

const responseHeaders = (protectedRoute = false) => ({
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: protectedRoute ? 'Cookie, Origin' : 'Origin',
  'Content-Type': 'application/json; charset=utf-8',
});

const errorResponse = (status: number, requestId: string, protectedRoute = false) =>
  Response.json({ error: 'Invalid request', requestId }, {
    status,
    headers: { ...responseHeaders(protectedRoute), 'x-request-id': requestId },
  });

const clientKey = async (address: string, secret: string) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(address)));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
};

const cookieValue = (request: Request): string | null => {
  const matches = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE_NAME.length + 1);
  return value && value.length <= 8192 ? value : null;
};

const sessionCookie = (token: string, expiresAt: unknown, now: number) => {
  const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
  const remaining = Math.floor((expires - now) / 1000);
  const maxAge = Math.min(MAX_SESSION_AGE_SECONDS, remaining);
  if (!Number.isFinite(maxAge) || maxAge <= 0 || token.length > 8192) return null;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
};

const clearCookie = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

const projectApiKey = (env: NodeJS.ProcessEnv): string | null => {
  const publishable = env.SUPABASE_PUBLISHABLE_KEY;
  if (publishable !== undefined) {
    return publishable === publishable.trim() && publishable.length > 'sb_publishable_'.length &&
        publishable.startsWith('sb_publishable_')
      ? publishable
      : null;
  }
  return env.SUPABASE_ANON_KEY || null;
};

const stripSessionCredentials = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(stripSessionCredentials);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[-_]/g, '').toLowerCase();
    if (['token', 'accesstoken', 'refreshtoken', 'session', 'sessiontoken', 'sessioncredential'].includes(normalized)) {
      delete (value as Record<string, unknown>)[key];
    } else {
      stripSessionCredentials(child);
    }
  }
};

const sameOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    const requestUrl = new URL(request.url);
    return host === requestUrl.host && new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
};

const actionFrom = (request: Request) => {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'session') return parts[2];
  return parts.length === 2 && parts[0] === 'api' && parts[1] === 'session'
    ? url.searchParams.get('action')
    : null;
};

const boundedBody = async (request: Request, maxBytes = MAX_BODY_BYTES): Promise<ArrayBuffer | undefined> => {
  if (request.method === 'GET') return undefined;
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > maxBytes) throw new Error('body too large');
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) throw new Error('body too large');
  return body.byteLength ? body : undefined;
};

const browserTelemetry = (body: ArrayBuffer | undefined): Omit<BrowserTelemetryLog, 'request_id'> | null => {
  if (!body) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const keys = Object.keys(event);
  if (keys.some((key) => !TELEMETRY_KEYS.has(key))
    || event.event !== 'browser_session_operation'
    || typeof event.operation !== 'string'
    || !TELEMETRY_OPERATIONS.has(event.operation)
    || typeof event.outcome !== 'string'
    || !TELEMETRY_OUTCOMES.has(event.outcome)
    || typeof event.durationMs !== 'number'
    || !Number.isInteger(event.durationMs)
    || event.durationMs < 0
    || event.durationMs > 60_000
    || (event.failureClass !== undefined
      && (typeof event.failureClass !== 'string' || !TELEMETRY_FAILURE_CLASSES.has(event.failureClass)))
    || (event.attempts !== undefined
      && (typeof event.attempts !== 'number' || !Number.isInteger(event.attempts) || event.attempts < 1 || event.attempts > 3))) {
    return null;
  }
  return {
    event: 'browser_session_operation',
    operation: event.operation as BrowserTelemetryLog['operation'],
    outcome: event.outcome as BrowserTelemetryLog['outcome'],
    duration_ms: event.durationMs,
    ...(event.failureClass === undefined ? {} : { failure_class: event.failureClass as BrowserTelemetryLog['failure_class'] }),
    ...(event.attempts === undefined ? {} : { attempts: event.attempts }),
  };
};

const acceptTelemetry = (identity: string, now: number): boolean => {
  const active = telemetryClients.get(identity);
  if (active && now - active.windowStartedAt < TELEMETRY_RATE_WINDOW_MS) {
    if (active.count >= TELEMETRY_RATE_LIMIT) return false;
    active.count++;
    return true;
  }
  if (!active && telemetryClients.size >= MAX_TELEMETRY_CLIENTS) {
    for (const [key, bucket] of telemetryClients) {
      if (now - bucket.windowStartedAt >= TELEMETRY_RATE_WINDOW_MS) telemetryClients.delete(key);
    }
    if (telemetryClients.size >= MAX_TELEMETRY_CLIENTS) return false;
  }
  telemetryClients.set(identity, { count: 1, windowStartedAt: now });
  return true;
};

export async function sessionProxy(
  request: Request,
  dependencies: {
    fetch: typeof fetch;
    env: NodeJS.ProcessEnv;
    now: () => number;
    id?: () => string;
    logger?: (entry: SessionLog) => void;
    upstreamTimeoutMs?: number;
  } = {
    fetch,
    env: process.env,
    now: Date.now,
  },
): Promise<Response> {
  const requestId = dependencies.id?.() ?? crypto.randomUUID();
  const startedAt = dependencies.now();
  const action = actionFrom(request);

  if (action === 'telemetry') {
    if (request.method !== 'POST') return errorResponse(405, requestId);
    if (!sameOrigin(request)) return errorResponse(403, requestId);
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return errorResponse(415, requestId);
    }
    const secret = dependencies.env.PIBA_PROXY_SECRET;
    if (!secret) return errorResponse(503, requestId);
    const address = request.headers.get('x-forwarded-for')?.trim();
    const identity = await clientKey(address && address.length <= 256 ? address : 'anonymous', secret);
    if (!acceptTelemetry(identity, startedAt)) return errorResponse(429, requestId);
    let body: ArrayBuffer | undefined;
    try {
      body = await boundedBody(request, MAX_TELEMETRY_BODY_BYTES);
    } catch {
      return errorResponse(413, requestId);
    }
    const event = browserTelemetry(body);
    if (!event) return errorResponse(400, requestId);
    try {
      (dependencies.logger ?? ((entry) => console.log(JSON.stringify(entry))))({ request_id: requestId, ...event });
    } catch {
      // Logging is best-effort and must not replace the response.
    }
    return Response.json({ ok: true, requestId }, {
      status: 202,
      headers: { ...responseHeaders(), 'x-request-id': requestId },
    });
  }

  const route = action ? ROUTES[action] : undefined;
  let identity: ProxyLog['client_identity'] = 'anonymous';
  let completed = false;
  const finish = (response: Response, failureClass?: ProxyFailureClass) => {
    if (!completed) {
      completed = true;
      const failure = failureClass ?? (response.status >= 400 ? 'upstream' : undefined);
      try {
        (dependencies.logger ?? ((entry) => console.log(JSON.stringify(entry))))({
          request_id: requestId,
          route: action ?? 'unknown',
          method: request.method,
          status: response.status,
          duration_ms: Math.max(0, dependencies.now() - startedAt),
          outcome: failure ? 'failure' : 'success',
          client_identity: identity,
          ...(failure ? { failure_class: failure } : {}),
        });
      } catch {
        // Logging is best-effort and must not replace the response.
      }
    }
    return response;
  };
  if (!route) return finish(errorResponse(404, requestId), 'validation');
  if (!route.methods.includes(request.method)) return finish(errorResponse(405, requestId, route.protected), 'validation');
  if (request.method !== 'GET' && !sameOrigin(request)) return finish(errorResponse(403, requestId, route.protected), 'auth');

  const supabaseUrl = dependencies.env.SUPABASE_URL;
  const apiKey = projectApiKey(dependencies.env);
  const proxySecret = dependencies.env.PIBA_PROXY_SECRET;
  if (!supabaseUrl || !apiKey || !proxySecret) return finish(errorResponse(503, requestId, route.protected), 'configuration');

  let base: URL;
  try {
    base = new URL(supabaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('invalid URL');
  } catch {
    return finish(errorResponse(503, requestId, route.protected), 'configuration');
  }

  const token = route.protected ? cookieValue(request) : null;
  if (route.protected && !token) return finish(errorResponse(401, requestId, true), 'auth');

  let body: ArrayBuffer | undefined;
  try {
    body = await boundedBody(request);
  } catch {
    return finish(errorResponse(413, requestId, route.protected), 'validation');
  }

  const headers = new Headers({
    apikey: apiKey,
    'x-piba-proxy-secret': proxySecret,
  });
  // Vercel overwrites x-forwarded-for before invoking the function. Never forward it;
  // bind only its HMAC to the authenticated proxy hop.
  const address = request.headers.get('x-forwarded-for')?.trim();
  if (address && address.length <= 256) {
    headers.set('x-piba-client-key', await clientKey(address, proxySecret));
    identity = 'trusted';
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  for (const name of ['content-type', 'idempotency-key', 'x-piba-operation-id']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, dependencies.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS);
  try {
    upstream = await dependencies.fetch(new URL(`/functions/v1/${route.upstream}`, base), {
      method: request.method,
      headers,
      body,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    return finish(errorResponse(503, requestId, route.protected), timedOut ? 'timeout' : 'transport');
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  }

  let payload: unknown = null;
  try {
    payload = await upstream.json();
  } catch {
    return finish(errorResponse(502, requestId, route.protected), 'upstream');
  }
  const outputHeaders = new Headers(responseHeaders(route.protected));
  const upstreamRequestId = upstream.headers.get('x-request-id');
  if (upstreamRequestId) outputHeaders.set('x-request-id', upstreamRequestId);
  const idempotencyKey = upstream.headers.get('idempotency-key');
  if (idempotencyKey) outputHeaders.set('idempotency-key', idempotencyKey);

  if (action === 'login' || action === 'refresh') {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const tokenValue = record.token;
    stripSessionCredentials(payload);
    if (!upstream.ok) return finish(Response.json(payload, { status: upstream.status, headers: outputHeaders }));
    const cookie = typeof tokenValue === 'string'
      ? sessionCookie(tokenValue, record.expiresAt, dependencies.now())
      : null;
    if (!cookie) return finish(errorResponse(502, requestId, route.protected), 'upstream');
    outputHeaders.set('Set-Cookie', cookie);
  }

  if (action === 'logout' && upstream.ok) {
    const confirmed = payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true;
    if (!confirmed) return finish(errorResponse(502, requestId, true), 'upstream');
    outputHeaders.set('Set-Cookie', clearCookie);
  }

  return finish(Response.json(payload, { status: upstream.status, headers: outputHeaders }));
}

export default { fetch: sessionProxy };
