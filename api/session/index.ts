const COOKIE_NAME = '__Host-piba_session';
const MAX_BODY_BYTES = 1024;
const MAX_SESSION_AGE_SECONDS = 8 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 8_000;

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

const boundedBody = async (request: Request): Promise<ArrayBuffer | undefined> => {
  if (request.method === 'GET') return undefined;
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) throw new Error('body too large');
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) throw new Error('body too large');
  return body.byteLength ? body : undefined;
};

export async function sessionProxy(
  request: Request,
  dependencies: {
    fetch: typeof fetch;
    env: NodeJS.ProcessEnv;
    now: () => number;
    id?: () => string;
    logger?: (entry: ProxyLog) => void;
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
  const apiKey = dependencies.env.SUPABASE_PUBLISHABLE_KEY ?? dependencies.env.SUPABASE_ANON_KEY;
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

  if ((action === 'login' || action === 'refresh') && upstream.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const tokenValue = record.token;
    const cookie = typeof tokenValue === 'string'
      ? sessionCookie(tokenValue, record.expiresAt, dependencies.now())
      : null;
    if (!cookie) return finish(errorResponse(502, requestId, route.protected), 'upstream');
    delete record.token;
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
