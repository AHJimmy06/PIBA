import { argon2id } from "npm:hash-wasm@4.12.0";
import { bytea, rpc } from "../_shared/db.ts";
import { hmac } from "../_shared/crypto.ts";
import {
  type CompletionLog,
  requestId,
  type SafeLogger,
  safeLogger,
} from "../_shared/http.ts";

type Candidate = {
  actor_id: string;
  credential_version: number;
  access_code_lookup_hash: string | null;
  access_code_hash: string | null;
};
type BackfillDeps = {
  rpc: typeof rpc;
  hash: (code: string) => Promise<string>;
  lookup: (code: string) => Promise<string>;
};
type BackfillTelemetry = {
  id: () => string;
  logger: SafeLogger;
  now: () => number;
};

const defaultDeps: BackfillDeps = {
  rpc,
  hash: (code) =>
    argon2id({
      password: code,
      salt: crypto.getRandomValues(new Uint8Array(16)),
      parallelism: 1,
      iterations: 3,
      memorySize: 65536,
      hashLength: 32,
      outputType: "encoded",
    }),
  lookup: async (code) => bytea(await hmac(`lookup:${code}`)),
};
const defaultTelemetry: BackfillTelemetry = {
  id: requestId,
  logger: safeLogger,
  now: () => performance.now(),
};

const localUrl = (url: string) =>
  /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);

const constantTimeEqual = async (left: string, right: string) => {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a[index] ^ b[index];
  }
  return mismatch === 0;
};

async function authorizeTarget(request: Request, url: string) {
  const environment = Deno.env.get("PIBA_DEPLOY_ENV");
  const projectRef = Deno.env.get("PIBA_BACKFILL_PROJECT_REF") ?? "";
  const releaseId = Deno.env.get("PIBA_BACKFILL_RELEASE_ID") ?? "";
  const expectedSecret = Deno.env.get("PIBA_BACKFILL_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-piba-backfill-secret") ?? "";
  const suppliedEnvironment = request.headers.get("x-piba-environment") ?? "";
  const suppliedProject = request.headers.get("x-piba-project-ref") ?? "";
  const suppliedRelease = request.headers.get("x-piba-release-id") ?? "";
  const canonicalUrl = localUrl(url)
    ? url
    : `https://${projectRef}.supabase.co`;
  if (
    !["local", "staging"].includes(environment ?? "") || !projectRef ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(releaseId) ||
    url !== canonicalUrl || expectedSecret.length < 32 ||
    suppliedSecret.length < 32 ||
    suppliedEnvironment !== environment || suppliedProject !== projectRef ||
    suppliedRelease !== releaseId ||
    !await constantTimeEqual(suppliedSecret, expectedSecret)
  ) {
    throw new Error("BACKFILL_TARGET_DENIED");
  }
}

export async function runBackfill(
  request: Request,
  deps: BackfillDeps = defaultDeps,
): Promise<
  {
    expected: number;
    processed: number;
    skipped: number;
    remaining: number;
    serverEnvironmentVerified: true;
  }
> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  await authorizeTarget(request, url);
  const rows = await deps.rpc<Candidate[]>("session_backfill_list", {});
  const expected = Number(Deno.env.get("PIBA_BACKFILL_EXPECTED_COUNT"));
  if (
    !Number.isSafeInteger(expected) || expected < 1 || rows.length !== expected
  ) throw new Error("BACKFILL_TARGET_MISMATCH");
  let processed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.access_code_hash && row.access_code_lookup_hash) {
      skipped++;
      continue;
    }
    const code = await deps.rpc<string | null>("session_backfill_read", {
      p_actor_id: row.actor_id,
      p_expected_version: row.credential_version,
    });
    if (!code) {
      skipped++;
      continue;
    }
    const hash = await deps.hash(code);
    if (
      await deps.rpc<boolean>("session_backfill_cas", {
        p_actor_id: row.actor_id,
        p_expected_version: row.credential_version,
        p_lookup_hash: await deps.lookup(code),
        p_access_code_hash: hash,
      })
    ) processed++;
    else skipped++;
  }
  const remaining = (await deps.rpc<Candidate[]>("session_backfill_list", {}))
    .filter((row) => !row.access_code_hash || !row.access_code_lookup_hash)
    .length;
  if (remaining !== 0) throw new Error("BACKFILL_INCOMPLETE");
  return {
    expected,
    processed,
    skipped,
    remaining,
    serverEnvironmentVerified: true,
  };
}

export async function backfillHandler(
  request: Request,
  deps: BackfillDeps = defaultDeps,
  telemetry: BackfillTelemetry = defaultTelemetry,
) {
  const id = telemetry.id();
  const startedAt = telemetry.now();
  let response: Response;
  let failureClass: CompletionLog["failure_class"];
  try {
    if (request.method !== "POST") throw new Error("BACKFILL_TARGET_DENIED");
    response = Response.json(await runBackfill(request, deps));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === "BACKFILL_TARGET_DENIED" ||
      message === "BACKFILL_TARGET_MISMATCH"
    ) {
      failureClass = "auth";
      response = Response.json(
        { error: "Backfill request denied", requestId: id, retryable: false },
        { status: 403 },
      );
    } else if (message === "BACKFILL_INCOMPLETE") {
      failureClass = "convergence";
      response = Response.json(
        { error: "Backfill incomplete", requestId: id, retryable: false },
        { status: 409 },
      );
    } else {
      failureClass = "dependency";
      response = Response.json(
        {
          error: "Backfill temporarily unavailable",
          requestId: id,
          retryable: true,
        },
        { status: 503 },
      );
    }
  }
  try {
    telemetry.logger({
      request_id: id,
      endpoint: "backfill",
      method: request.method,
      status: response.status,
      duration_ms: Math.max(0, telemetry.now() - startedAt),
      outcome: response.ok ? "success" : "failure",
      ...(failureClass ? { failure_class: failureClass } : {}),
    });
  } catch {
    // Telemetry is best-effort and must not replace the automation response.
  }
  return response;
}

if (import.meta.main) Deno.serve((request) => backfillHandler(request));
