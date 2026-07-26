import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1.0.8";
import { bearer } from "./session.ts";
import {
  failureClass,
  handleCors,
  p95DurationMs,
  readJsonBody,
  requireProjectApiKey,
  requireSessionProxy,
  safeError,
  withCompletionTelemetry,
} from "./http.ts";

const projectRequest = (apiKey?: string, proxySecret?: string) =>
  new Request("http://localhost", {
    headers: {
      ...(apiKey ? { apikey: apiKey } : {}),
      ...(proxySecret ? { "x-piba-proxy-secret": proxySecret } : {}),
    },
  });

const envGetter =
  (values: Record<string, string | undefined>) => (name: string) =>
    values[name];

Deno.test("accepts configured modern publishable and legacy anon project keys", async () => {
  const modern = "sb_publishable_modern-key";
  const legacy = "legacy-anon-key";
  const getEnv = envGetter({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: modern }),
    SUPABASE_ANON_KEY: legacy,
  });

  await requireProjectApiKey(projectRequest(modern), getEnv);
  await requireProjectApiKey(projectRequest(legacy), getEnv);
});

Deno.test("rejects wrong, missing, and malformed project key configuration", async () => {
  const valid = envGetter({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
      default: "sb_publishable_expected",
    }),
    SUPABASE_ANON_KEY: "legacy-anon-key",
  });
  await assertRejects(() =>
    requireProjectApiKey(projectRequest("wrong"), valid)
  );
  await assertRejects(() => requireProjectApiKey(projectRequest(), valid));
  await assertRejects(() =>
    requireProjectApiKey(projectRequest("legacy-anon-key"), envGetter({}))
  );
  for (
    const malformed of [
      "not-json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ default: "publishable-key" }),
    ]
  ) {
    await assertRejects(() =>
      requireProjectApiKey(
        projectRequest("legacy-anon-key"),
        envGetter({
          SUPABASE_PUBLISHABLE_KEYS: malformed,
          SUPABASE_ANON_KEY: "legacy-anon-key",
        }),
      )
    );
  }
});

Deno.test("requires the proxy secret independently of a valid project key", async () => {
  const previousAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const previousPublishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const previousProxy = Deno.env.get("PIBA_PROXY_SECRET");
  try {
    Deno.env.set(
      "SUPABASE_PUBLISHABLE_KEYS",
      JSON.stringify({
        default: "sb_publishable_expected",
      }),
    );
    Deno.env.delete("SUPABASE_ANON_KEY");
    Deno.env.set("PIBA_PROXY_SECRET", "proxy-secret");
    await requireSessionProxy(
      projectRequest("sb_publishable_expected", "proxy-secret"),
    );
    await assertRejects(() =>
      requireSessionProxy(projectRequest("sb_publishable_expected", "wrong"))
    );
  } finally {
    if (previousAnon === undefined) Deno.env.delete("SUPABASE_ANON_KEY");
    else Deno.env.set("SUPABASE_ANON_KEY", previousAnon);
    if (previousPublishable === undefined) {
      Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS");
    } else Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", previousPublishable);
    if (previousProxy === undefined) Deno.env.delete("PIBA_PROXY_SECRET");
    else Deno.env.set("PIBA_PROXY_SECRET", previousProxy);
  }
});

Deno.test("rejects a disallowed browser origin before handler work", async () => {
  const response = handleCors(
    new Request("http://localhost", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example" },
    }),
  );
  assertEquals(response?.status, 403);
});

Deno.test("classifies auth, rate, dependency, and exception logs without sensitive context", async () => {
  assertEquals(failureClass(new Error("missing bearer")), "auth");
  assertEquals(failureClass(new Error("rate limited")), "rate_limit");
  assertEquals(
    failureClass(new Error("database operation failed")),
    "dependency",
  );
  assertEquals(
    failureClass(new Error("raw secret user@example.com")),
    "exception",
  );
  const entries: unknown[] = [];
  const times = [10, 25];
  await withCompletionTelemetry(
    new Request("http://localhost", { method: "GET" }),
    "current-user",
    {
      id: () => "request-1",
      logger: (entry) => entries.push(entry),
      now: () => times.shift()!,
    },
    async () => new Response(null, { status: 500 }),
  );
  assertEquals(entries, [{
    request_id: "request-1",
    endpoint: "current-user",
    method: "GET",
    status: 500,
    duration_ms: 15,
    outcome: "failure",
    failure_class: "dependency",
  }]);
  assertEquals(JSON.stringify(entries).includes("secret"), false);
  assertEquals(JSON.stringify(entries).includes("@"), false);
});

Deno.test("logger failures cannot replace completed success or failure responses", async () => {
  for (
    const expected of [
      { status: 201, body: { result: "created" } },
      { status: 429, body: { error: "controlled" } },
    ]
  ) {
    let attempts = 0;
    const response = await withCompletionTelemetry(
      new Request("http://localhost", { method: "POST" }),
      "test-endpoint",
      {
        id: () => "request-1",
        logger: () => {
          attempts++;
          throw new Error("sink unavailable");
        },
        now: () => 10,
      },
      async () => Response.json(expected.body, { status: expected.status }),
    );

    assertEquals(response.status, expected.status);
    assertEquals(await response.json(), expected.body);
    assertEquals(attempts, 1);
  }
});

Deno.test("p95 duration matches percentile_cont interpolation deterministically", () => {
  assertEquals(p95DurationMs([]), null);
  assertEquals(
    p95DurationMs([0, 10, 20, 30, 40].map((duration_ms) => ({ duration_ms }))),
    38,
  );
});

Deno.test("accepts allowed preflight and rejects malformed methods, bodies, and bearers deterministically", async () => {
  Deno.env.set("PIBA_ALLOWED_ORIGINS", "https://app.example");
  const preflight = handleCors(
    new Request("http://localhost", {
      method: "OPTIONS",
      headers: { origin: "https://app.example" },
    }),
  );
  assertEquals(preflight?.status, 204);
  assertEquals(
    preflight?.headers.get("access-control-allow-origin"),
    "https://app.example",
  );
  await assertRejects(() =>
    readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    )
  );
  await assertRejects(() =>
    readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    )
  );
  await assertRejects(() =>
    readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: { b: { c: { d: { e: 1 } } } } }),
      }),
    )
  );
  assertThrows(() => bearer(new Request("http://localhost")));
  assertEquals(
    bearer(
      new Request("http://localhost", {
        headers: { authorization: "Bearer token" },
      }),
    ),
    "token",
  );
});

Deno.test("limits JSON request bodies and returns generic errors with a request id", async () => {
  await assertRejects(() =>
    readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(1025) }),
      }),
    )
  );
  const response = safeError("request-1");
  assertEquals(response.status, 400);
  assertEquals(response.headers.get("x-request-id"), "request-1");
  assertEquals(await response.json(), {
    error: "Invalid request",
    requestId: "request-1",
  });
});
