const MAX_BODY_BYTES = 1024;

const allowedOrigins = () =>
  new Set(
    (Deno.env.get("PIBA_ALLOWED_ORIGINS") ?? "")
      .split(",").map((origin) => origin.trim()).filter(Boolean),
  );

export const requestId = () => crypto.randomUUID();

export type CompletionLog = {
  request_id: string;
  endpoint: string;
  method: string;
  status: number;
  duration_ms: number;
  outcome: "success" | "failure";
  failure_class?:
    | "auth"
    | "rate_limit"
    | "dependency"
    | "validation"
    | "convergence"
    | "refresh_replay_family_revoked"
    | "exception";
};
export type SafeLogger = (entry: CompletionLog) => void;
export const safeLogger: SafeLogger = (entry) =>
  console.log(JSON.stringify(entry));

export const failureClass = (
  error: unknown,
): NonNullable<CompletionLog["failure_class"]> => {
  if (error instanceof SyntaxError) return "validation";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("rate limited")) return "rate_limit";
  if (/missing bearer|invalid token|project key/i.test(message)) return "auth";
  if (/database|configuration|operation failed/i.test(message)) {
    return "dependency";
  }
  if (/invalid|body/i.test(message)) return "validation";
  return "exception";
};

const responseFailures = new WeakMap<
  Response,
  NonNullable<CompletionLog["failure_class"]>
>();

const responseFailureClass = (
  response: Response,
): NonNullable<CompletionLog["failure_class"]> | undefined => {
  const specific = responseFailures.get(response);
  if (specific) return specific;
  const status = response.status;
  if (status < 400) return undefined;
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "dependency";
  return "validation";
};

export async function withCompletionTelemetry(
  request: Request,
  endpoint: string,
  dependencies: {
    id: () => string;
    logger: SafeLogger;
    now: () => number;
  },
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const preflight = handleCors(request);
  if (preflight) return preflight;

  const id = dependencies.id();
  const startedAt = dependencies.now();
  let response: Response;
  try {
    response = await handler(id);
  } catch {
    response = safeError(id, request.headers.get("origin"), 503);
  }
  const failure = responseFailureClass(response);
  try {
    dependencies.logger({
      request_id: id,
      endpoint,
      method: request.method,
      status: response.status,
      duration_ms: Math.max(0, dependencies.now() - startedAt),
      outcome: failure ? "failure" : "success",
      ...(failure ? { failure_class: failure } : {}),
    });
  } catch {
    // Completion telemetry is best-effort and must not replace the response.
  }
  return response;
}

export function p95DurationMs(entries: Pick<CompletionLog, "duration_ms">[]) {
  if (entries.length === 0) return null;
  const values = entries.map(({ duration_ms }) => duration_ms).sort((a, b) =>
    a - b
  );
  const rank = (values.length - 1) * 0.95;
  const lower = Math.floor(rank);
  const fraction = rank - lower;
  return values[lower] + (values[Math.ceil(rank)] - values[lower]) * fraction;
}

export const corsHeaders = (origin: string | null) => ({
  ...(origin && allowedOrigins().has(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {}),
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, idempotency-key, x-request-id, x-piba-client-key, x-piba-operation-id, x-piba-proxy-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "600",
});

export const handleCors = (request: Request): Response | null => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().has(origin)) {
    return new Response(null, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  return null;
};

const equal = async (left: string, right: string) => {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aa.length; index++) {
    difference |= aa[index] ^ bb[index];
  }
  return difference === 0;
};

/** Gateway routes the function; this only validates the project API key, never user identity. */
export async function requireProjectApiKey(
  request: Request,
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Promise<void> {
  const expected: string[] = [];
  const publishableKeys = getEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (publishableKeys !== undefined) {
    try {
      const parsed: unknown = JSON.parse(publishableKeys);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid project key configuration");
      }
      const values = Object.values(parsed);
      if (
        values.length === 0 ||
        values.some((value) =>
          typeof value !== "string" ||
          value !== value.trim() ||
          value.length <= "sb_publishable_".length ||
          !value.startsWith("sb_publishable_")
        )
      ) {
        throw new Error("invalid project key configuration");
      }
      expected.push(...values as string[]);
    } catch {
      throw new Error("invalid project key");
    }
  }
  const legacyAnonKey = getEnv("SUPABASE_ANON_KEY");
  if (legacyAnonKey) expected.push(legacyAnonKey);
  const provided = request.headers.get("apikey");
  if (
    !provided || expected.length === 0 ||
    !(await Promise.all(expected.map((value) => equal(provided, value)))).some(
      Boolean,
    )
  ) {
    throw new Error("invalid project key");
  }
}

export async function requireSessionProxy(request: Request): Promise<void> {
  await requireProjectApiKey(request);
  const expected = Deno.env.get("PIBA_PROXY_SECRET");
  const provided = request.headers.get("x-piba-proxy-secret");
  if (!expected || !provided || !(await equal(provided, expected))) {
    throw new Error("invalid proxy secret");
  }
}

type LimitRpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

async function consumeLimit(
  endpoint: string,
  material: string,
  windowSeconds: number,
  limit: number,
  rpc: LimitRpc,
) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)),
  );
  const bucket = `\\x${
    Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")
  }`;
  const allowed = await rpc<boolean>("consume_endpoint_limit", {
    p_endpoint: endpoint,
    p_bucket_hash: bucket,
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });
  if (!allowed) throw new Error("rate limited");
}

export async function consumeEndpointLimit(
  endpoint: string,
  dimensions: string[],
  windowSeconds: number,
  limit: number,
  rpc: LimitRpc,
): Promise<void> {
  await consumeLimit(
    endpoint,
    ["global", ...dimensions].join(":"),
    windowSeconds,
    limit,
    rpc,
  );
}

export async function consumeIpAndFamilyLimits(
  request: Request,
  endpoint: string,
  family: string,
  ipLimit: number,
  familyLimit: number,
  rpc: LimitRpc,
): Promise<void> {
  const supplied = request.headers.get("x-piba-client-key");
  const clientKey = supplied && /^[0-9a-f]{64}$/.test(supplied)
    ? supplied
    : "anonymous";
  await consumeLimit(`${endpoint}:ip`, clientKey, 300, ipLimit, rpc);
  await consumeLimit(`${endpoint}:family`, family, 300, familyLimit, rpc);
}

export const json = (
  body: unknown,
  status = 200,
  origin: string | null = null,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });

export const safeError = (
  id: string,
  origin: string | null = null,
  status = 400,
  telemetryFailure?: NonNullable<CompletionLog["failure_class"]>,
) => {
  const response = json(
    { error: "Invalid request", requestId: id },
    status,
    origin,
  );
  response.headers.set("x-request-id", id);
  if (telemetryFailure) responseFailures.set(response, telemetryFailure);
  return response;
};

export async function readJsonBody<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (
    !request.headers.get("content-type")?.includes("application/json") ||
    length > MAX_BODY_BYTES
  ) throw new Error("invalid body");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("invalid body");
  }
  const value = JSON.parse(text) as T;
  const visit = (input: unknown, depth = 0): void => {
    if (
      depth > 4 ||
      (input && typeof input === "object" && Object.keys(input).length > 20)
    ) throw new Error("invalid body");
    if (input && typeof input === "object") {
      Object.values(input).forEach((child) => visit(child, depth + 1));
    }
  };
  visit(value);
  return value;
}
