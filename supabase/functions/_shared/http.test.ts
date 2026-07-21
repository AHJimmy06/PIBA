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
  safeError,
  withCompletionTelemetry,
} from "./http.ts";

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
  assertEquals(await response.json(), {
    error: "Invalid request",
    requestId: "request-1",
  });
});
