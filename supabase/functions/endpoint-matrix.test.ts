import { assertEquals, assertExists } from "jsr:@std/assert@1.0.8";
import { type LoginDependencies, loginHandler } from "./session-login/index.ts";
import {
  type RefreshDependencies,
  refreshHandler,
} from "./session-refresh/index.ts";
import {
  type LogoutDependencies,
  logoutHandler,
} from "./session-logout/index.ts";
import {
  type ProfileDependencies,
  profileHandler,
} from "./session-profile/index.ts";
import { type UsersDependencies, usersHandler } from "./session-users/index.ts";

const origin = "https://app.example";
const apiKey = "test-anon-key";
const proxySecret = "test-proxy-secret";
const url = "http://localhost/functions/v1/test";
const claims = {
  sub: "actor-1",
  jti: "jti-1",
  family: "family-1",
  session: "session-1",
};
const user = {
  id: "actor-1",
  first_name: "Ada",
  last_name: "Lovelace",
  role: "LIDER_REPASO",
  default_instrument: null,
};
const bytes = async () => new Uint8Array([1]);
const logger = () => undefined;
const now = () => 100;
const generic = { error: "Invalid request", requestId: "request-1" };
const request = (
  method: string,
  body?: string,
  authorization = "Bearer valid",
  projectKey: string | null = apiKey,
  idempotencyKey: string | null = "00000000-0000-4000-8000-000000000011",
  suppliedProxySecret: string | null = proxySecret,
) =>
  new Request(url, {
    method,
    headers: {
      origin,
      ...(projectKey === null ? {} : { apikey: projectKey }),
      ...(suppliedProxySecret === null
        ? {}
        : { "x-piba-proxy-secret": suppliedProxySecret }),
      authorization,
      "x-piba-operation-id": "00000000-0000-4000-8000-000000000001",
      ...(idempotencyKey === null ? {} : { "idempotency-key": idempotencyKey }),
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
const refreshDeps = (): RefreshDependencies => ({
  id: () => "request-1",
  verify: async () => claims,
  hash: bytes,
  rpc:
    (async (name: string) =>
      name === "consume_endpoint_limit"
        ? true
        : name === "session_refresh_status"
        ? [{ status: "fresh" }]
        : [{
          status: "rotated",
          session_id: "session-2",
          family_id: "family-1",
          actor_id: "actor-1",
          jti: "00000000-0000-4000-8000-000000000002",
          issued_at: "2026-01-01T00:00:00.000Z",
          expires_at: "expiry",
        }]) as RefreshDependencies["rpc"],
  issue: async () => "token-2",
  uuid: () => "jti-2",
  logger,
  now,
  expiresAt: () => "2099-01-01T00:00:00.000Z",
});
const logoutDeps = (): LogoutDependencies => ({
  id: () => "request-1",
  verify: async () => claims,
  hash: bytes,
  rpc:
    (async (name: string) =>
      name === "consume_endpoint_limit" || name === "session_revoke"
        ? true
        : null) as LogoutDependencies[
        "rpc"
      ],
  logger,
  now,
});
const profileDeps = (): ProfileDependencies => ({
  id: () => "request-1",
  verify: async () => claims,
  read: async () => user,
  update: async (_id, input) => ({ ...user, ...input }),
  rpc: (async () => true) as ProfileDependencies["rpc"],
  logger,
  now,
});
const usersDeps = (): UsersDependencies => ({
  id: () => "request-1",
  verify: async () => claims,
  safeUsers: async () => [user],
  list: async () => [user],
  create: async (input) => ({
    status: "created",
    id: input.p_actor_id as string,
    first_name: input.p_first_name as string,
    last_name: input.p_last_name as string,
    role: input.p_role as string,
    default_instrument: input.p_default_instrument as string | null,
  }),
  rpc:
    (async (name: string) =>
      name === "consume_endpoint_limit" || name === "session_set_credential"
        ? true
        : null) as UsersDependencies[
        "rpc"
      ],
  hash: (async () => "hash") as UsersDependencies["hash"],
  hmac: async () => new Uint8Array(32).fill(1),
  uuid: () => "00000000-0000-4000-8000-000000000012",
  random: (value) => value,
  logger,
  now,
});

const endpoints = [
  {
    name: "login",
    method: "POST",
    run: (req: Request) => loginHandler(req, loginDeps()),
  },
  {
    name: "refresh",
    method: "POST",
    run: (req: Request) => refreshHandler(req, refreshDeps()),
  },
  {
    name: "logout",
    method: "POST",
    run: (req: Request) => logoutHandler(req, logoutDeps()),
  },
  {
    name: "current-user",
    method: "GET",
    run: (req: Request) => profileHandler(req, profileDeps()),
  },
  {
    name: "list-users",
    method: "GET",
    run: (req: Request) => usersHandler(req, usersDeps()),
  },
  {
    name: "create-user",
    method: "POST",
    run: (req: Request) => usersHandler(req, usersDeps()),
  },
  {
    name: "update-profile",
    method: "POST",
    run: (req: Request) => profileHandler(req, profileDeps()),
  },
];

Deno.env.set("PIBA_ALLOWED_ORIGINS", origin);
Deno.env.set("SUPABASE_ANON_KEY", apiKey);
Deno.env.set("PIBA_PROXY_SECRET", proxySecret);

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
  Deno.test(`${endpoint.name}: missing and invalid proxy secret stop privileged work`, async () => {
    for (const secret of [null, "invalid-secret"]) {
      const response = await endpoint.run(
        request(
          endpoint.method,
          endpoint.method === "POST" ? "{}" : undefined,
          "Bearer valid",
          apiKey,
          "00000000-0000-4000-8000-000000000011",
          secret,
        ),
      );
      assertEquals(response.status, 401);
      assertEquals(await json(response), generic);
    }
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

for (const endpoint of endpoints.filter((item) => item.name !== "login")) {
  Deno.test(`${endpoint.name}: bearer state matrix`, async () => {
    for (
      const authorization of ["", "Basic value", `Bearer ${"x".repeat(8192)}`]
    ) {
      const response = await endpoint.run(
        request(
          endpoint.method,
          endpoint.method === "POST" ? "{}" : undefined,
          authorization,
        ),
      );
      assertEquals(response.status, 401);
    }
  });
}

const bodyEndpoints = [
  { name: "login", run: (req: Request) => loginHandler(req, loginDeps()) },
  {
    name: "create-user",
    run: (req: Request) => usersHandler(req, usersDeps()),
  },
  {
    name: "update-profile",
    run: (req: Request) => profileHandler(req, profileDeps()),
  },
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

Deno.test("refresh and logout: durable operation and success output matrix", async () => {
  assertEquals(
    await json(await refreshHandler(request("POST"), refreshDeps())),
    { token: "token-2", expiresAt: "expiry" },
  );
  assertEquals(await json(await logoutHandler(request("POST"), logoutDeps())), {
    ok: true,
    requestId: "request-1",
  });
  const replay = refreshDeps();
  replay.rpc =
    (async (name: string) =>
      name === "session_refresh_status"
        ? [{ status: "replay" }]
        : [{ status: "replay_revoked" }]) as RefreshDependencies["rpc"];
  assertEquals((await refreshHandler(request("POST"), replay)).status, 401);
});

Deno.test("logout: false or failed revocation is non-success and never confirms logout", async () => {
  for (const outcome of [false, "error"] as const) {
    const deps = logoutDeps();
    const baseRpc = deps.rpc;
    deps.rpc = (async (name: string, args: Record<string, unknown>) => {
      if (name !== "session_revoke") return baseRpc(name, args);
      if (outcome === "error") throw new Error("database operation failed");
      return false;
    }) as LogoutDependencies["rpc"];
    const response = await logoutHandler(request("POST"), deps);
    assertEquals(response.status, 503);
    assertEquals(await json(response), {
      error: "Revocation unresolved",
      requestId: "request-1",
    });
  }
});

for (
  const endpoint of [
    {
      name: "refresh",
      ipLimit: 20,
      familyLimit: 10,
      run: refreshHandler,
      deps: refreshDeps,
    },
    {
      name: "logout",
      ipLimit: 30,
      familyLimit: 10,
      run: logoutHandler,
      deps: logoutDeps,
    },
  ] as const
) {
  Deno.test(`${endpoint.name}: independent IP and family five-minute boundaries pass before work`, async () => {
    const seen: Array<Record<string, unknown>> = [];
    let durableCalls = 0;
    const deps = endpoint.deps();
    const baseRpc = deps.rpc;
    deps.rpc = (async (name: string, args: Record<string, unknown>) => {
      if (name === "consume_endpoint_limit") {
        seen.push(args);
        return true;
      }
      if (name === "session_refresh_status") return baseRpc(name, args);
      durableCalls++;
      return baseRpc(name, args);
    }) as never;
    await endpoint.run(request("POST"), deps as never);
    assertEquals(
      seen.map(({ p_endpoint, p_window_seconds, p_limit }) => ({
        p_endpoint,
        p_window_seconds,
        p_limit,
      })),
      [
        {
          p_endpoint: `${endpoint.name}:ip`,
          p_window_seconds: 300,
          p_limit: endpoint.ipLimit,
        },
        {
          p_endpoint: `${endpoint.name}:family`,
          p_window_seconds: 300,
          p_limit: endpoint.familyLimit,
        },
      ],
    );
    assertEquals(durableCalls, 1);

    for (const rejectedBucket of [0, 1]) {
      const blocked = endpoint.deps();
      let bucket = 0;
      let blockedWork = 0;
      blocked.rpc = (async (name: string) => {
        if (name === "session_refresh_status") return [{ status: "fresh" }];
        if (name === "consume_endpoint_limit") {
          return bucket++ !== rejectedBucket;
        }
        blockedWork++;
        return null;
      }) as never;
      const response = await endpoint.run(request("POST"), blocked as never);
      assertEquals(
        await json(response),
        endpoint.name === "logout"
          ? { error: "Revocation unresolved", requestId: "request-1" }
          : generic,
      );
      assertEquals(blockedWork, 0);
    }
  });
}

Deno.test("current-user and update-profile: success and generic dependency error matrix", async () => {
  assertEquals(
    await json(await profileHandler(request("GET"), profileDeps())),
    { user },
  );
  const updated = await profileHandler(
    request("POST", body({ firstName: "Grace", lastName: "Hopper" })),
    profileDeps(),
  );
  assertEquals((await json(updated)).user.first_name, "Grace");
  const failed = profileDeps();
  failed.read = async () => {
    throw new Error("sensitive");
  };
  const dependencyFailure = await profileHandler(request("GET"), failed);
  assertEquals(dependencyFailure.status, 503);
  assertEquals(await json(dependencyFailure), generic);
});

Deno.test("profile and create-user: exact JSON field types fail safely", async () => {
  const profileCases = [
    { firstName: null, lastName: "User" },
    { firstName: [], lastName: "User" },
    { firstName: "Test", lastName: 1 },
    { firstName: "Test", lastName: "User", defaultInstrument: null },
    { firstName: "Test", lastName: "User", extra: true },
  ];
  const createCases = [
    { firstName: null, lastName: "User", role: "GENERAL" },
    { firstName: [], lastName: "User", role: "GENERAL" },
    { firstName: "Test", lastName: 1, role: "GENERAL" },
    { firstName: "Test", lastName: "User", role: null },
    {
      firstName: "Test",
      lastName: "User",
      role: "GENERAL",
      defaultInstrument: [],
    },
    { firstName: "Test", lastName: "User", role: "GENERAL", extra: true },
  ];
  for (const input of profileCases) {
    const response = await profileHandler(
      request("POST", body(input)),
      profileDeps(),
    );
    assertEquals(response.status, "extra" in input ? 400 : 422);
    assertEquals(await json(response), generic);
  }
  for (const input of createCases) {
    const deps = usersDeps();
    deps.safeUsers = async () => {
      throw new Error("create validation must not precheck role");
    };
    const response = await usersHandler(request("POST", body(input)), deps);
    assertEquals(response.status, "extra" in input ? 400 : 422);
    assertEquals(await json(response), generic);
  }
});

Deno.test("list-users and create-user: leader role, success, and generic error matrix", async () => {
  assertEquals(await json(await usersHandler(request("GET"), usersDeps())), {
    users: [user],
  });
  const created = await usersHandler(
    request(
      "POST",
      body({ firstName: "Grace", lastName: "Hopper", role: "GENERAL" }),
    ),
    usersDeps(),
  );
  assertEquals(created.status, 201);
  const createdBody = await json(created);
  assertEquals(createdBody.accessCode, "010101010101");
  assertExists(createdBody.user);

  for (const method of ["GET", "POST"]) {
    const nonLeader = usersDeps();
    nonLeader.safeUsers = async () => [{ ...user, role: "GENERAL" }];
    nonLeader.create = async () => ({
      status: "forbidden",
      id: "",
      first_name: "",
      last_name: "",
      role: "",
      default_instrument: null,
    });
    const response = await usersHandler(
      request(
        method,
        method === "POST"
          ? body({ firstName: "Grace", lastName: "Hopper", role: "GENERAL" })
          : undefined,
      ),
      nonLeader,
    );
    assertEquals(response.status, 403);
    assertEquals(await json(response), generic);
  }
  const failed = usersDeps();
  failed.list = async () => {
    throw new Error("sensitive");
  };
  const dependencyFailure = await usersHandler(request("GET"), failed);
  assertEquals(dependencyFailure.status, 503);
  assertEquals(await json(dependencyFailure), generic);
});

Deno.test("create-user: requires a strict caller-provided Idempotency-Key", async () => {
  const input = body({
    firstName: "Grace",
    lastName: "Hopper",
    role: "GENERAL",
  });
  const cases = [
    { key: null, status: 400 },
    { key: "", status: 422 },
    { key: "00000000-0000-4000-8000-00000000001", status: 422 },
    { key: "00000000-0000-1000-8000-000000000011", status: 422 },
    { key: "00000000-0000-4000-7000-000000000011", status: 422 },
    { key: "00000000-0000-4000-8000-00000000001z", status: 422 },
  ];
  for (const { key, status } of cases) {
    const deps = usersDeps();
    let privilegedCalls = 0;
    deps.create = async () => {
      privilegedCalls++;
      throw new Error("invalid idempotency key must stop create work");
    };
    deps.rpc = (async () => {
      privilegedCalls++;
      throw new Error("invalid idempotency key must stop rate-limit work");
    }) as UsersDependencies["rpc"];
    const response = await usersHandler(
      request("POST", input, "Bearer valid", apiKey, key),
      deps,
    );
    assertEquals(response.status, status);
    assertEquals(await json(response), generic);
    assertEquals(privilegedCalls, 0);
  }
});

Deno.test("create-user: lost response retry returns the same canonical user and access code", async () => {
  const deps = usersDeps();
  let creates = 0;
  const operationIds: unknown[] = [];
  const actorIds = [
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000013",
  ];
  deps.uuid = () => actorIds.shift()!;
  let canonical: Awaited<ReturnType<UsersDependencies["create"]>> | undefined;
  deps.safeUsers = async () => {
    throw new Error("create must not perform a precheck or follow-up read");
  };
  deps.create = async (input) => {
    creates++;
    operationIds.push(input.p_operation_id);
    canonical ??= {
      status: "created",
      id: input.p_actor_id as string,
      first_name: input.p_first_name as string,
      last_name: input.p_last_name as string,
      role: input.p_role as string,
      default_instrument: input.p_default_instrument as string | null,
    };
    return { ...canonical, status: creates === 1 ? "created" : "repeated" };
  };
  const createRequest = () =>
    request(
      "POST",
      body({ firstName: "Grace", lastName: "Hopper", role: "GENERAL" }),
    );
  const first = await usersHandler(createRequest(), deps);
  const lostResponseRetry = await usersHandler(createRequest(), deps);
  assertEquals(first.status, 201);
  assertEquals(lostResponseRetry.status, 201);
  assertEquals(await json(lostResponseRetry), await json(first));
  assertEquals(
    lostResponseRetry.headers.get("Idempotency-Key"),
    "00000000-0000-4000-8000-000000000011",
  );
  assertEquals(operationIds, [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000011",
  ]);
  assertEquals(creates, 2);
});

Deno.test("refresh: dependency failures are 503 and emit dependency telemetry", async () => {
  const entries: unknown[] = [];
  const deps = refreshDeps();
  deps.logger = (entry) => entries.push(entry);
  deps.rpc = (async (name: string) => {
    if (name === "consume_endpoint_limit") return true;
    throw new Error("database operation failed");
  }) as RefreshDependencies["rpc"];
  const response = await refreshHandler(request("POST"), deps);
  assertEquals(response.status, 503);
  assertEquals(entries[0], {
    request_id: "request-1",
    endpoint: "refresh",
    method: "POST",
    status: 503,
    duration_ms: 0,
    outcome: "failure",
    failure_class: "dependency",
  });
});

Deno.test("refresh: different-operation replay revokes the family with distinct telemetry", async () => {
  const entries: unknown[] = [];
  const deps = refreshDeps();
  deps.logger = (entry) => entries.push(entry);
  deps.rpc =
    (async (name: string) =>
      name === "session_refresh_status"
        ? [{ status: "replay" }]
        : [{ status: "replay_revoked" }]) as RefreshDependencies["rpc"];
  const response = await refreshHandler(request("POST"), deps);
  assertEquals(response.status, 401);
  assertEquals(await json(response), generic);
  assertEquals(entries[0], {
    request_id: "request-1",
    endpoint: "refresh",
    method: "POST",
    status: 401,
    duration_ms: 0,
    outcome: "failure",
    failure_class: "refresh_replay_family_revoked",
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

Deno.test("login: spoofed forwarding headers cannot change the auxiliary identity", async () => {
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
  assertEquals(ipHashes.size, 1);
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

Deno.test("refresh: successor signing failure preserves the idempotent rotation for retry", async () => {
  const deps = refreshDeps();
  let rotations = 0;
  let limitCalls = 0;
  let rotated = false;
  let signingAttempts = 0;
  deps.issue = async () => {
    if (++signingAttempts === 1) throw new Error("signing unavailable");
    return "recovered-token";
  };
  const baseRpc = deps.rpc;
  deps.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === "session_refresh_status") {
      return rotated
        ? [{
          status: "repeated",
          session_id: "session-2",
          family_id: "family-1",
          actor_id: "actor-1",
          jti: "00000000-0000-4000-8000-000000000002",
          issued_at: "2026-01-01T00:00:00.000Z",
          expires_at: "expiry",
        }]
        : [{ status: "fresh" }];
    }
    if (name === "consume_endpoint_limit") {
      limitCalls++;
      if (limitCalls > 2) throw new Error("rate limited");
    }
    if (name === "session_rotate") {
      rotations++;
      rotated = true;
    }
    return baseRpc(name, args);
  }) as RefreshDependencies["rpc"];
  assertEquals((await refreshHandler(request("POST"), deps)).status, 503);
  const retry = await refreshHandler(request("POST"), deps);
  assertEquals(retry.status, 200);
  assertEquals(await json(retry), {
    token: "recovered-token",
    expiresAt: "expiry",
  });
  assertEquals(rotations, 1);
  assertEquals(limitCalls, 2);
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

Deno.test("refresh: signs exact successor claims after atomic persistence", async () => {
  const refresh = refreshDeps();
  const order: string[] = [];
  const ids = ["refresh-jti", "00000000-0000-4000-8000-000000000013"];
  refresh.uuid = () => ids.shift()!;
  refresh.expiresAt = () => "2099-01-01T00:00:00.000Z";
  refresh.issue = async (actor, family, session, jti, expiresAt, issuedAt) => {
    order.push(
      `sign:${actor}:${family}:${session}:${jti}:${expiresAt}:${issuedAt}`,
    );
    return "signed-refresh";
  };
  const baseRpc = refresh.rpc;
  refresh.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === "session_rotate") {
      order.push(`persist:${args.p_new_session_id}:${args.p_new_expires_at}`);
    }
    return baseRpc(name, args);
  }) as RefreshDependencies["rpc"];
  assertEquals((await refreshHandler(request("POST"), refresh)).status, 200);
  assertEquals(order, [
    "persist:00000000-0000-4000-8000-000000000013:2099-01-01T00:00:00.000Z",
    "sign:actor-1:family-1:session-2:00000000-0000-4000-8000-000000000002:expiry:2026-01-01T00:00:00.000Z",
  ]);
});

const telemetryEndpoints = [
  {
    name: "login",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = loginDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return loginHandler(
        request(
          "POST",
          body({ accessCode: "code" }),
          "Bearer valid",
          valid ? apiKey : null,
        ),
        deps,
      );
    },
  },
  {
    name: "refresh",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = refreshDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return refreshHandler(
        request("POST", undefined, "Bearer valid", valid ? apiKey : null),
        deps,
      );
    },
  },
  {
    name: "logout",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = logoutDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return logoutHandler(
        request("POST", undefined, "Bearer valid", valid ? apiKey : null),
        deps,
      );
    },
  },
  {
    name: "current-user",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = profileDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return profileHandler(
        request("GET", undefined, "Bearer valid", valid ? apiKey : null),
        deps,
      );
    },
  },
  {
    name: "list-users",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = usersDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return usersHandler(
        request("GET", undefined, "Bearer valid", valid ? apiKey : null),
        deps,
      );
    },
  },
  {
    name: "create-user",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = usersDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return usersHandler(
        request(
          "POST",
          body({ firstName: "Grace", lastName: "Hopper", role: "GENERAL" }),
          "Bearer valid",
          valid ? apiKey : null,
        ),
        deps,
      );
    },
  },
  {
    name: "update-profile",
    run: (entries: unknown[], clock: () => number, valid: boolean) => {
      const deps = profileDeps();
      deps.logger = (entry) => entries.push(entry);
      deps.now = clock;
      return profileHandler(
        request(
          "POST",
          body({ firstName: "Grace", lastName: "Hopper" }),
          "Bearer valid",
          valid ? apiKey : null,
        ),
        deps,
      );
    },
  },
];

for (const endpoint of telemetryEndpoints) {
  Deno.test(`${endpoint.name}: emits one safe deterministic completion event for success and failure`, async () => {
    for (const valid of [true, false]) {
      const entries: unknown[] = [];
      const times = [100, 137];
      const response = await endpoint.run(entries, () => times.shift()!, valid);
      assertEquals(entries.length, 1);
      assertEquals(entries, [{
        request_id: "request-1",
        endpoint: endpoint.name,
        method:
          endpoint.name === "current-user" || endpoint.name === "list-users"
            ? "GET"
            : "POST",
        status: valid ? response.status : 401,
        duration_ms: 37,
        outcome: valid ? "success" : "failure",
        ...(valid ? {} : { failure_class: "auth" }),
      }]);
      const serialized = JSON.stringify(entries);
      for (
        const unsafe of [
          "token",
          "code",
          "hash",
          "Ada",
          "actor-1",
          "127.0.0.1",
          "first_name",
        ]
      ) {
        assertEquals(serialized.includes(unsafe), false);
      }
    }
  });
}
