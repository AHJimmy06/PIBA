import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.8";
import { backfillHandler, runBackfill } from "./index.ts";

const candidate = (actor_id: string, version = 1) => ({
  actor_id,
  credential_version: version,
  access_code_lookup_hash: null,
  access_code_hash: null,
});
const secret = "local-backfill-secret-12345678901234567890";
const authorizedRequest = (
  environment = "local",
  projectRef = "local-project",
  releaseId = "local-release",
  suppliedSecret = secret,
) =>
  new Request("http://localhost/backfill", {
    method: "POST",
    headers: {
      "x-piba-backfill-secret": suppliedSecret,
      "x-piba-environment": environment,
      "x-piba-project-ref": projectRef,
      "x-piba-release-id": releaseId,
    },
  });
const configureLocal = () => {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("PIBA_DEPLOY_ENV", "local");
  Deno.env.set("PIBA_BACKFILL_PROJECT_REF", "local-project");
  Deno.env.set("PIBA_BACKFILL_RELEASE_ID", "local-release");
  Deno.env.set("PIBA_BACKFILL_SECRET", secret);
};

Deno.test("backfill resumes after partial failure and remains idempotent without exposing secrets", async () => {
  configureLocal();
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "2");
  const completed = new Set<string>();
  let failOnce = true;
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values) => output.push(values.join(" "));
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    const id = String(args.p_actor_id ?? "");
    if (name === "session_backfill_list") {
      return [candidate("one"), candidate("two")].map((row) =>
        completed.has(row.actor_id)
          ? {
            ...row,
            access_code_lookup_hash: "lookup",
            access_code_hash: "hash",
          }
          : row
      ) as T;
    }
    if (name === "session_backfill_read") {
      if (id === "two" && failOnce) {
        failOnce = false;
        throw new Error("transient");
      }
      return (`secret-${id}`) as T;
    }
    if (name === "session_backfill_cas") {
      const added = !completed.has(id);
      completed.add(id);
      return added as T;
    }
    throw new Error("unexpected RPC");
  };
  const deps = {
    rpc,
    hash: async () => "argon-hash",
    lookup: async () => "lookup-hash",
  };
  try {
    await assertRejects(() => runBackfill(authorizedRequest(), deps));
    assertEquals(completed, new Set(["one"]));
    assertEquals(await runBackfill(authorizedRequest(), deps), {
      expected: 2,
      processed: 1,
      skipped: 1,
      remaining: 0,
      serverEnvironmentVerified: true,
    });
    assertEquals(await runBackfill(authorizedRequest(), deps), {
      expected: 2,
      processed: 0,
      skipped: 2,
      remaining: 0,
      serverEnvironmentVerified: true,
    });
    assertEquals(output.join(""), "");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("backfill treats a credential-version CAS conflict as skipped", async () => {
  configureLocal();
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "1");
  let complete = false;
  const rpc = async <T>(name: string): Promise<T> => {
    if (name === "session_backfill_list") {
      if (!complete) return [candidate("raced")] as T;
      return [{
        ...candidate("raced"),
        access_code_lookup_hash: "lookup",
        access_code_hash: "hash",
      }] as T;
    }
    if (name === "session_backfill_read") return "never-log-this-code" as T;
    if (name === "session_backfill_cas") {
      complete = true;
      return false as T;
    }
    throw new Error("unexpected RPC");
  };
  assertEquals(
    await runBackfill(authorizedRequest(), {
      rpc,
      hash: async () => "hash",
      lookup: async () => "lookup",
    }),
    {
      expected: 1,
      processed: 0,
      skipped: 1,
      remaining: 0,
      serverEnvironmentVerified: true,
    },
  );
});

Deno.test("backfill requires the explicitly approved exact target", async () => {
  configureLocal();
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "7");
  await assertRejects(
    () =>
      runBackfill(authorizedRequest(), {
        rpc: async () => [candidate("only-one")] as never,
        hash: async () => "hash",
        lookup: async () => "lookup",
      }),
    Error,
    "BACKFILL_TARGET_MISMATCH",
  );
});

Deno.test("backfill permits only an exactly authorized staging target and always denies production", async () => {
  const remoteUrl = "https://staging-ref.supabase.co";
  const authorization = "release-specific-authorization-1234567890";
  Deno.env.set("SUPABASE_URL", remoteUrl);
  Deno.env.set("PIBA_DEPLOY_ENV", "staging");
  Deno.env.set("PIBA_BACKFILL_PROJECT_REF", "staging-ref");
  Deno.env.set("PIBA_BACKFILL_RELEASE_ID", "release-123");
  Deno.env.set("PIBA_BACKFILL_SECRET", authorization);
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "1");
  const complete = [{
    ...candidate("complete"),
    access_code_lookup_hash: "lookup",
    access_code_hash: "hash",
  }];
  const deps = {
    rpc: async () => complete as never,
    hash: async () => "hash",
    lookup: async () => "lookup",
  };
  assertEquals(
    await runBackfill(
      authorizedRequest("staging", "staging-ref", "release-123", authorization),
      deps,
    ),
    {
      expected: 1,
      processed: 0,
      skipped: 1,
      remaining: 0,
      serverEnvironmentVerified: true,
    },
  );

  for (
    const request of [
      authorizedRequest("preview", "staging-ref", "release-123", authorization),
      authorizedRequest("staging", "other-ref", "release-123", authorization),
      authorizedRequest(
        "staging",
        "staging-ref",
        "other-release",
        authorization,
      ),
      authorizedRequest(
        "staging",
        "staging-ref",
        "release-123",
        "wrong-authorization-value-1234567890",
      ),
    ]
  ) {
    await assertRejects(
      () => runBackfill(request, deps),
      Error,
      "BACKFILL_TARGET_DENIED",
    );
  }
  Deno.env.set("PIBA_DEPLOY_ENV", "production");
  await assertRejects(
    () =>
      runBackfill(
        authorizedRequest(
          "production",
          "staging-ref",
          "release-123",
          authorization,
        ),
        deps,
      ),
    Error,
    "BACKFILL_TARGET_DENIED",
  );
});

Deno.test("backfill denies missing and invalid caller secrets with one generic response", async () => {
  configureLocal();
  const deps = {
    rpc: async () => [] as never,
    hash: async () => "hash",
    lookup: async () => "lookup",
  };
  for (
    const request of [
      new Request("http://localhost/backfill", { method: "POST" }),
      authorizedRequest(
        "local",
        "local-project",
        "local-release",
        "incorrect-secret-value-123456789012345",
      ),
    ]
  ) {
    const response = await backfillHandler(request, deps, {
      id: () => "request-1",
      logger: () => undefined,
      now: () => 0,
    });
    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
      error: "Backfill request denied",
      requestId: "request-1",
      retryable: false,
    });
  }
});

Deno.test("backfill exposes safe distinct status classes and structured telemetry", async () => {
  configureLocal();
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "1");
  const cases = [
    {
      rpc: async () => {
        throw new Error("database unavailable");
      },
      status: 503,
      body: {
        error: "Backfill temporarily unavailable",
        requestId: "request-1",
        retryable: true,
      },
      failure_class: "dependency",
    },
    {
      rpc: async <T>(name: string): Promise<T> =>
        (name === "session_backfill_list"
          ? [candidate("remaining")]
          : null) as T,
      status: 409,
      body: {
        error: "Backfill incomplete",
        requestId: "request-1",
        retryable: false,
      },
      failure_class: "convergence",
    },
  ];
  for (const testCase of cases) {
    const entries: unknown[] = [];
    const response = await backfillHandler(
      authorizedRequest(),
      {
        rpc: testCase.rpc,
        hash: async () => "hash",
        lookup: async () => "lookup",
      },
      {
        id: () => "request-1",
        logger: (entry) => entries.push(entry),
        now: () => 10,
      },
    );
    assertEquals(response.status, testCase.status);
    assertEquals(await response.json(), testCase.body);
    assertEquals(entries, [{
      request_id: "request-1",
      endpoint: "backfill",
      method: "POST",
      status: testCase.status,
      duration_ms: 0,
      outcome: "failure",
      failure_class: testCase.failure_class,
    }]);
    assertEquals(JSON.stringify(entries).includes("secret"), false);
  }
});

Deno.test("backfill repairs lookup-present access-hash-null credentials", async () => {
  configureLocal();
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "1");
  let row: {
    actor_id: string;
    credential_version: number;
    access_code_lookup_hash: string | null;
    access_code_hash: string | null;
  } = {
    ...candidate("partial"),
    access_code_lookup_hash: "existing-lookup",
  };
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    if (name === "session_backfill_list") return [row] as T;
    if (name === "session_backfill_read") return "legacy-code" as T;
    if (name === "session_backfill_cas") {
      assertEquals(args.p_lookup_hash, "existing-lookup");
      row = { ...row, access_code_hash: String(args.p_access_code_hash) };
      return true as T;
    }
    throw new Error("unexpected RPC");
  };
  assertEquals(
    await runBackfill(authorizedRequest(), {
      rpc,
      hash: async () => "argon-hash",
      lookup: async () => "existing-lookup",
    }),
    {
      expected: 1,
      processed: 1,
      skipped: 0,
      remaining: 0,
      serverEnvironmentVerified: true,
    },
  );
});

Deno.test("concurrent backfills converge and a restarted runner observes exact completion", async () => {
  configureLocal();
  Deno.env.set("PIBA_BACKFILL_EXPECTED_COUNT", "7");
  const rows = Array.from(
    { length: 7 },
    (_, index) => candidate(String(index)),
  );
  const complete = new Set<string>();
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    if (name === "session_backfill_list") {
      return rows.map((row) =>
        complete.has(row.actor_id)
          ? {
            ...row,
            access_code_lookup_hash: "lookup",
            access_code_hash: "hash",
          }
          : row
      ) as T;
    }
    if (name === "session_backfill_read") {
      return `secret-${args.p_actor_id}` as T;
    }
    if (name === "session_backfill_cas") {
      const id = String(args.p_actor_id);
      const won = !complete.has(id);
      complete.add(id);
      return won as T;
    }
    throw new Error("unexpected RPC");
  };
  const deps = { rpc, hash: async () => "hash", lookup: async () => "lookup" };
  await Promise.all([
    runBackfill(authorizedRequest(), deps),
    runBackfill(authorizedRequest(), deps),
  ]);
  assertEquals(complete.size, 7);
  assertEquals(await runBackfill(authorizedRequest(), deps), {
    expected: 7,
    processed: 0,
    skipped: 7,
    remaining: 0,
    serverEnvironmentVerified: true,
  });
});

Deno.test({
  name: "recovery migration repairs partial credentials with CAS",
  ignore: Deno.env.get("PIBA_PR2_SQL_HARNESS") !== "1",
  async fn() {
    const container = `piba-pr2-${crypto.randomUUID()}`;
    const run = async (args: string[], input?: string) => {
      const child = new Deno.Command("docker", {
        args,
        stdin: input === undefined ? "null" : "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      if (input !== undefined) {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(input));
        await writer.close();
      }
      const output = await child.output();
      if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
      }
      return new TextDecoder().decode(output.stdout);
    };
    try {
      await run([
        "run",
        "--rm",
        "-d",
        "--name",
        container,
        "-e",
        "POSTGRES_PASSWORD=postgres",
        "postgres:17-alpine",
      ]);
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          await run(["exec", container, "pg_isready", "-U", "postgres"]);
          break;
        } catch {
          if (attempt === 29) {
            throw new Error("PostgreSQL harness did not start");
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      const migration = await Deno.readTextFile(
        new URL(
          "../../migrations/20260721044311_recover_partial_backfill_credentials.sql",
          import.meta.url,
        ),
      );
      const fixture = `
        create role anon;
        create role authenticated;
        create role service_role;
        create schema app_private;
        create table public.users(
          id uuid primary key,
          first_name text not null,
          last_name text not null,
          role text not null,
          default_instrument text,
          access_code text
        );
        create table public.security_settings(
          id boolean primary key,
          legacy_code_cutoff_at timestamptz not null,
          migration_state text not null,
          fallback_enabled boolean not null,
          updated_at timestamptz not null,
          updated_by_release text not null
        );
        insert into public.security_settings values(
          true,'infinity','compatibility',true,clock_timestamp(),'harness'
        );
        create table app_private.user_credentials(
          actor_id uuid primary key references public.users(id),
          access_code_hash text,
          access_code_lookup_hash bytea,
          credential_version bigint not null default 1,
          code_rotation_required boolean not null default true,
          code_rotated_at timestamptz
        );
        create table app_private.login_rate_limits(
          dimension text not null,
          bucket_hash bytea not null,
          window_started_at timestamptz not null,
          attempt_count integer not null check(attempt_count > 0),
          updated_at timestamptz not null default clock_timestamp(),
          primary key(dimension,bucket_hash,window_started_at)
        );
        insert into public.users values(
          '00000000-0000-4000-8000-000000000001','Ada','Lovelace','GENERAL',null,'legacy-code'
        );
        insert into app_private.user_credentials(
          actor_id,access_code_lookup_hash,access_code_hash
        ) values(
          '00000000-0000-4000-8000-000000000001',decode(repeat('11',32),'hex'),null
        );
      `;
      const assertions = `
        do $assert$
        declare
          repaired boolean;
          stale_cas boolean;
          credential app_private.user_credentials;
          window_start timestamptz := date_trunc('minute', clock_timestamp());
          first_refund boolean;
          duplicate_refund boolean;
          ip_count integer;
          code_count integer;
        begin
          repaired := app_private.cas_backfill(
            '00000000-0000-4000-8000-000000000001',1,
            decode(repeat('11',32),'hex'),
            '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA'
          );
          if not repaired then raise exception 'partial credential was not repaired'; end if;
          select * into credential from app_private.user_credentials
            where actor_id = '00000000-0000-4000-8000-000000000001';
          if credential.credential_version <> 2
             or credential.access_code_hash is null
             or credential.code_rotation_required then
            raise exception 'repaired credential state is invalid';
          end if;
          stale_cas := app_private.cas_backfill(
            credential.actor_id,1,credential.access_code_lookup_hash,credential.access_code_hash
          );
          if stale_cas then raise exception 'stale CAS unexpectedly succeeded'; end if;

          insert into app_private.login_rate_limits values
            ('ip',decode(repeat('22',32),'hex'),window_start,2,clock_timestamp()),
            ('code',decode(repeat('33',32),'hex'),window_start,2,clock_timestamp());
          first_refund := app_private.refund_login_attempt(
            '00000000-0000-4000-8000-000000000002',
            decode(repeat('22',32),'hex'),decode(repeat('33',32),'hex'),window_start
          );
          duplicate_refund := app_private.refund_login_attempt(
            '00000000-0000-4000-8000-000000000002',
            decode(repeat('22',32),'hex'),decode(repeat('33',32),'hex'),window_start
          );
          select attempt_count into ip_count from app_private.login_rate_limits
            where dimension = 'ip' and bucket_hash = decode(repeat('22',32),'hex');
          select attempt_count into code_count from app_private.login_rate_limits
            where dimension = 'code' and bucket_hash = decode(repeat('33',32),'hex');
          if not first_refund or duplicate_refund or ip_count <> 1 or code_count <> 1 then
            raise exception 'login refund CAS was not idempotent';
          end if;
          if has_function_privilege(
               'anon','public.session_refund_login_attempt(uuid,bytea,bytea,timestamp with time zone)','EXECUTE'
             ) or not has_function_privilege(
               'service_role','public.session_refund_login_attempt(uuid,bytea,bytea,timestamp with time zone)','EXECUTE'
             ) then
            raise exception 'login refund privilege boundary is invalid';
          end if;
        end
        $assert$;
        select 'PR2_RECOVERY_MIGRATION_OK';
      `;
      const output = await run(
        [
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        `${fixture}\n${migration}\n${assertions}`,
      );
      assertEquals(output.includes("PR2_RECOVERY_MIGRATION_OK"), true);
    } finally {
      await new Deno.Command("docker", {
        args: ["rm", "-f", container],
        stdout: "null",
        stderr: "null",
      }).output();
    }
  },
});
