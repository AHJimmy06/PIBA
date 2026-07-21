import { assertEquals } from "jsr:@std/assert@1.0.8";
import { type LoginDependencies, loginHandler } from "./session-login/index.ts";
const origin = "https://app.example";
const apiKey = "test-anon-key";
const url = "http://localhost/functions/v1/test";
const bytes = async () => new Uint8Array([1]);
const logger = () => undefined;
const now = () => 100;
const generic = { error: "Invalid request", requestId: "request-1" };
const request = (
  method: string,
  body?: string,
  authorization = "Bearer valid",
  projectKey: string | null = apiKey,
) =>
  new Request(url, {
    method,
    headers: {
      origin,
      ...(projectKey === null ? {} : { apikey: projectKey }),
      authorization,
      "x-piba-operation-id": "00000000-0000-4000-8000-000000000001",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body,
  });
const body = (value: unknown) => JSON.stringify(value);
const json = async (response: Response) => await response.json();

const loginDeps = (): LoginDependencies => ({
  id: () => "request-1",
  rpc:
    (async (name: string) =>
      name === "consume_endpoint_limit"
        ? true
        : name === "session_begin_login"
        ? [{
          status: "candidate",
          actor_id: "actor-1",
          credential_version: 1,
          access_code_hash: "hash",
          legacy_access_code: null,
          legacy_allowed: false,
          attempt_window: "2099-01-01T00:00:00.000Z",
        }]
        : [{
          status: "issued",
          session_id: "session-1",
          family_id: "family-1",
          actor_id: "actor-1",
          role: "GENERAL",
          first_name: "Ada",
          last_name: "Lovelace",
          default_instrument: null,
          expires_at: "expiry",
        }]) as LoginDependencies["rpc"],
  hmac: bytes,
  sha256: bytes,
  verify: (async () => true) as LoginDependencies["verify"],
  hash: (async () => "hash") as LoginDependencies["hash"],
  signing: async () => undefined,
  issue: async () => "token",
  uuid: () => "jti-2",
  random: (value) => value,
  logger,
  now,
  expiresAt: () => "2099-01-01T00:00:00.000Z",
});
const endpoints = [
  {
    name: "login",
    method: "POST",
    run: (req: Request) => loginHandler(req, loginDeps()),
  },
];

Deno.env.set("PIBA_ALLOWED_ORIGINS", origin);
Deno.env.set("SUPABASE_ANON_KEY", apiKey);

for (const endpoint of endpoints) {
  Deno.test(`${endpoint.name}: origin, OPTIONS, and method matrix`, async () => {
    assertEquals(
      (await endpoint.run(
        new Request(url, { method: "OPTIONS", headers: { origin } }),
      )).status,
      204,
    );
    assertEquals(
      (await endpoint.run(
        new Request(url, {
          method: "OPTIONS",
          headers: { origin: "https://attacker.example" },
        }),
      )).status,
      403,
    );
    const wrongMethod = endpoint.method === "GET" ? "DELETE" : "PUT";
    const response = await endpoint.run(request(wrongMethod));
    assertEquals(response.status, 405);
    assertEquals(await json(response), generic);
  });
}

for (const endpoint of endpoints) {
  Deno.test(`${endpoint.name}: missing and invalid apikey stop privileged work`, async () => {
    for (const key of [null, "invalid-key"]) {
      const response = await endpoint.run(
        request(
          endpoint.method,
          endpoint.method === "POST" ? "{}" : undefined,
          "Bearer valid",
          key,
        ),
      );
      assertEquals(response.status, 401);
      assertEquals(await json(response), generic);
    }
  });
}

const bodyEndpoints = [
  { name: "login", run: (req: Request) => loginHandler(req, loginDeps()) },
];
for (const endpoint of bodyEndpoints) {
  Deno.test(`${endpoint.name}: body byte, depth, and malformed JSON matrix`, async () => {
    const cases = [
      "{",
      "null",
      body([]),
      body("code"),
      body({ value: "x".repeat(1025) }),
      body({ a: { b: { c: { d: { e: 1 } } } } }),
    ];
    for (const value of cases) {
      const response = await endpoint.run(request("POST", value));
      assertEquals(response.status, endpoint.name === "login" ? 401 : 400);
      assertEquals(await json(response), generic);
    }
  });
}

Deno.test("login: rate-limit, generic error/request-id, and success matrix", async () => {
  const throttled = loginDeps();
  throttled.rpc =
    (async (name: string) =>
      name === "session_begin_login"
        ? [{ status: "throttled" }]
        : []) as LoginDependencies["rpc"];
  const limited = await loginHandler(
    request("POST", body({ accessCode: "code" })),
    throttled,
  );
  assertEquals(limited.status, 401);
  assertEquals(await json(limited), generic);

  const failed = loginDeps();
  failed.rpc = (async () => {
    throw new Error("secret database detail");
  }) as LoginDependencies["rpc"];
  const dependencyFailure = await loginHandler(
    request("POST", body({ accessCode: "code" })),
    failed,
  );
  assertEquals(dependencyFailure.status, 503);
  assertEquals(await json(dependencyFailure), generic);

  const success = await loginHandler(
    request("POST", body({ accessCode: "code" })),
    loginDeps(),
  );
  assertEquals(success.status, 200);
  assertEquals(await json(success), {
    token: "token",
    expiresAt: "expiry",
    user: {
      id: "actor-1",
      first_name: "Ada",
      last_name: "Lovelace",
      role: "GENERAL",
      default_instrument: null,
    },
  });
});
Deno.test("login: code limiter accepts the production boundary of 5 and rejects attempt 6", async () => {
  const deps = loginDeps();
  let codeAttempts = 0;
  const baseRpc = deps.rpc;
  deps.rpc = ((name: string, args: Record<string, unknown>) => {
    if (name === "consume_endpoint_limit") return Promise.resolve(true);
    if (name === "session_begin_login" && ++codeAttempts > 5) {
      return Promise.resolve([{ status: "throttled" }]);
    }
    return baseRpc(name, args);
  }) as LoginDependencies["rpc"];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await loginHandler(
      request("POST", body({ accessCode: "same-code" })),
      deps,
    );
    assertEquals(response.status, attempt <= 5 ? 200 : 401);
  }
});

Deno.test("login: spoofing IP cannot bypass the durable per-code budget", async () => {
  const deps = loginDeps();
  let codeAttempts = 0;
  let expectedCodeHash: unknown;
  const ipHashes = new Set<string>();
  deps.hmac = async (value) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const baseRpc = deps.rpc;
  deps.rpc = ((name: string, args: Record<string, unknown>) => {
    if (name === "session_begin_login") {
      expectedCodeHash ??= args.p_code_hash;
      assertEquals(args.p_code_hash, expectedCodeHash);
      ipHashes.add(String(args.p_ip_hash));
      if (++codeAttempts > 5) return Promise.resolve([{ status: "throttled" }]);
    }
    return baseRpc(name, args);
  }) as LoginDependencies["rpc"];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await loginHandler(
      new Request(request("POST", body({ accessCode: "same-code" })), {
        headers: {
          ...Object.fromEntries(request("POST").headers),
          "content-type": "application/json",
          "x-forwarded-for": `198.51.100.${attempt}`,
        },
        body: body({ accessCode: "same-code" }),
      }),
      deps,
    );
    assertEquals(response.status, attempt <= 5 ? 200 : 401);
  }
  assertEquals(ipHashes.size, 6);
});

Deno.test("login: auxiliary IP limiter accepts the production boundary of 10 and rejects attempt 11", async () => {
  const deps = loginDeps();
  let ipAttempts = 0;
  const baseRpc = deps.rpc;
  deps.rpc = ((name: string, args: Record<string, unknown>) => {
    if (name === "consume_endpoint_limit") return Promise.resolve(true);
    if (name === "session_begin_login" && ++ipAttempts > 10) {
      return Promise.resolve([{ status: "throttled" }]);
    }
    return baseRpc(name, args);
  }) as LoginDependencies["rpc"];
  for (let attempt = 1; attempt <= 11; attempt++) {
    const response = await loginHandler(
      new Request(request("POST", body({ accessCode: `code-${attempt}` })), {
        headers: {
          ...Object.fromEntries(request("POST").headers),
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.10",
        },
        body: body({ accessCode: `code-${attempt}` }),
      }),
      deps,
    );
    assertEquals(response.status, attempt <= 10 ? 200 : 401);
  }
});

Deno.test("login: controlled rejection branches emit deterministic safe telemetry", async () => {
  const entries: unknown[] = [];
  const deps = loginDeps();
  deps.logger = (entry) => entries.push(entry);
  deps.rpc = (async () => {
    throw new Error("rate limited");
  }) as LoginDependencies["rpc"];
  const response = await loginHandler(
    request("POST", body({ accessCode: "secret-code" })),
    deps,
  );
  assertEquals(response.status, 429);
  assertEquals(entries, [{
    request_id: "request-1",
    endpoint: "login",
    method: "POST",
    status: 429,
    duration_ms: 0,
    outcome: "failure",
    failure_class: "rate_limit",
  }]);
  assertEquals(JSON.stringify(entries).includes("secret-code"), false);
});
Deno.test("login: candidate signing failure leaves no active session and returns 503", async () => {
  const deps = loginDeps();
  let finalizations = 0;
  let refunds = 0;
  deps.issue = async () => {
    throw new Error("signing unavailable");
  };
  const baseRpc = deps.rpc;
  deps.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === "session_finalize_login") finalizations++;
    if (name === "session_refund_login_attempt") {
      refunds++;
      return true;
    }
    return baseRpc(name, args);
  }) as LoginDependencies["rpc"];
  assertEquals(
    (await loginHandler(request("POST", body({ accessCode: "code" })), deps))
      .status,
    503,
  );
  assertEquals(finalizations, 0);
  assertEquals(refunds, 1);
});

Deno.test("login: five transient signing failures do not consume the code budget", async () => {
  const deps = loginDeps();
  let signingAttempts = 0;
  let codeBudget = 0;
  let ipBudget = 0;
  let refunds = 0;
  let requestIds = 0;
  deps.id = () =>
    `00000000-0000-4000-8000-${String(++requestIds).padStart(12, "0")}`;
  deps.issue = async () => {
    if (++signingAttempts <= 5) throw new Error("signing unavailable");
    return "token";
  };
  const baseRpc = deps.rpc;
  deps.rpc = ((name: string, args: Record<string, unknown>) => {
    if (name === "session_begin_login") {
      codeBudget++;
      ipBudget++;
      if (codeBudget > 5 || ipBudget > 10) {
        return Promise.resolve([{ status: "throttled" }]);
      }
    }
    if (name === "session_refund_login_attempt") {
      codeBudget--;
      ipBudget--;
      refunds++;
      return Promise.resolve(true);
    }
    return baseRpc(name, args);
  }) as LoginDependencies["rpc"];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await loginHandler(
      request("POST", body({ accessCode: "valid-code" })),
      deps,
    );
    assertEquals(response.status, attempt <= 5 ? 503 : 200);
  }
  assertEquals(refunds, 5);
  assertEquals(codeBudget, 1);
  assertEquals(ipBudget, 1);
});

Deno.test("login: bad credentials and throttling never refund budgets", async () => {
  for (const outcome of ["bad-credentials", "throttled"] as const) {
    const deps = loginDeps();
    let refunds = 0;
    if (outcome === "bad-credentials") deps.verify = async () => false;
    const baseRpc = deps.rpc;
    deps.rpc = ((name: string, args: Record<string, unknown>) => {
      if (name === "session_refund_login_attempt") {
        refunds++;
        return Promise.resolve(true);
      }
      if (name === "session_begin_login" && outcome === "throttled") {
        return Promise.resolve([{ status: "throttled" }]);
      }
      return baseRpc(name, args);
    }) as LoginDependencies["rpc"];
    const response = await loginHandler(
      request("POST", body({ accessCode: "code" })),
      deps,
    );
    assertEquals(response.status, 401);
    assertEquals(refunds, 0);
  }
});
