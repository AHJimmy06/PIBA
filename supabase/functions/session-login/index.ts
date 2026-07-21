import { argon2id, argon2Verify } from "npm:hash-wasm@4.12.0";
import { bytea, rpc } from "../_shared/db.ts";
import { hmac, sha256 } from "../_shared/crypto.ts";
import {
  failureClass,
  json,
  readJsonBody,
  requestId,
  requireProjectApiKey,
  safeError,
  type SafeLogger,
  safeLogger,
  withCompletionTelemetry,
} from "../_shared/http.ts";
import { assertSessionSigning, issueSession } from "../_shared/session.ts";

type Candidate = {
  status: string;
  actor_id: string | null;
  credential_version: number | null;
  access_code_hash: string | null;
  legacy_access_code: string | null;
  legacy_allowed: boolean;
  attempt_window: string | null;
};
const dummyHash =
  "$argon2id$v=19$m=65536,t=3,p=1$cGliYS1kdW1teS1zYWx0$cGliYS1kdW1teS1oYXNoLXRoaXMtaXMtbm90LXZhbGlk";

export type LoginDependencies = {
  id: () => string;
  rpc: typeof rpc;
  hmac: typeof hmac;
  sha256: typeof sha256;
  verify: typeof argon2Verify;
  hash: typeof argon2id;
  signing: typeof assertSessionSigning;
  issue: typeof issueSession;
  uuid: () => string;
  random: (array: Uint8Array) => Uint8Array;
  logger: SafeLogger;
  now: () => number;
  expiresAt: () => string;
};

const dependencies: LoginDependencies = {
  id: requestId,
  rpc,
  hmac,
  sha256,
  verify: argon2Verify,
  hash: argon2id,
  signing: assertSessionSigning,
  issue: issueSession,
  uuid: () => crypto.randomUUID(),
  random: (array) => crypto.getRandomValues(array),
  logger: safeLogger,
  now: () => performance.now(),
  expiresAt: () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
};

export async function loginHandler(
  request: Request,
  deps: LoginDependencies = dependencies,
) {
  const origin = request.headers.get("origin");
  return withCompletionTelemetry(request, "login", deps, async (id) => {
    if (request.method !== "POST") return safeError(id, origin, 405);
    try {
      await requireProjectApiKey(request);
    } catch {
      return safeError(id, origin, 401);
    }
    try {
      // Credential attacks use durable code and auxiliary IP buckets. Broad
      // request-volume protection belongs at the gateway, not a low global login cap.
      const body = await readJsonBody<unknown>(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("invalid body");
      }
      const { accessCode } = body as { accessCode?: unknown };
      if (
        typeof accessCode !== "string" || accessCode.length < 1 ||
        accessCode.length > 128
      ) throw new Error("invalid");
      await deps.signing();
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
      const [lookup, ipHash, codeHash] = await Promise.all([
        deps.hmac(`lookup:${accessCode}`),
        deps.hmac(`ip:${ip}`),
        deps.hmac(`code:${accessCode}`),
      ]);
      const candidateRows = await deps.rpc<Candidate[]>("session_begin_login", {
        p_lookup_hash: bytea(lookup),
        p_ip_hash: bytea(ipHash),
        p_code_hash: bytea(codeHash),
      });
      const candidate = candidateRows[0];
      const verifiedHash = candidate?.access_code_hash
        ? await deps.verify({
          password: accessCode,
          hash: candidate.access_code_hash,
        })
        : await deps.verify({ password: accessCode, hash: dummyHash }).catch(
          () => false,
        );
      const legacyValid = Boolean(
        candidate?.legacy_allowed &&
          candidate.legacy_access_code === accessCode,
      );
      if (
        !candidate || candidate.status !== "candidate" ||
        (!verifiedHash && !legacyValid) || !candidate.actor_id ||
        candidate.credential_version === null || !candidate.attempt_window
      ) return safeError(id, origin, 401);
      const upgrade = legacyValid && !candidate.access_code_hash
        ? await deps.hash({
          password: accessCode,
          salt: deps.random(new Uint8Array(16)),
          parallelism: 1,
          iterations: 3,
          memorySize: 65536,
          hashLength: 32,
          outputType: "encoded",
        })
        : null;
      const jti = deps.uuid();
      const sessionId = deps.uuid();
      const familyId = deps.uuid();
      const expiresAt = deps.expiresAt();
      let token: string;
      try {
        token = await deps.issue(
          candidate.actor_id,
          familyId,
          sessionId,
          jti,
          expiresAt,
        );
      } catch {
        // The request ID is generated internally and never accepted from the caller.
        await deps.rpc<boolean>("session_refund_login_attempt", {
          p_request_id: id,
          p_ip_hash: bytea(ipHash),
          p_code_hash: bytea(codeHash),
          p_window_started_at: candidate.attempt_window,
        });
        return safeError(id, origin, 503);
      }
      const rows = await deps.rpc<
        Array<
          {
            status: string;
            session_id: string;
            family_id: string;
            actor_id: string;
            role: string;
            first_name: string;
            last_name: string;
            default_instrument: string | null;
            expires_at: string;
          }
        >
      >("session_finalize_login", {
        p_actor_id: candidate.actor_id,
        p_expected_version: candidate.credential_version,
        p_lookup_hash: bytea(lookup),
        p_verified_existing_hash: candidate.access_code_hash,
        p_upgrade_hash: upgrade,
        p_session_id: sessionId,
        p_family_id: familyId,
        p_jti_hash: bytea(await deps.sha256(jti)),
        p_expires_at: expiresAt,
      });
      const result = rows[0];
      if (!result || result.status !== "issued") {
        return safeError(id, origin, 401);
      }
      return json(
        {
          token,
          expiresAt: result.expires_at,
          user: {
            id: result.actor_id,
            first_name: result.first_name,
            last_name: result.last_name,
            role: result.role,
            default_instrument: result.default_instrument,
          },
        },
        200,
        origin,
      );
    } catch (error) {
      const kind = failureClass(error);
      const status = kind === "rate_limit"
        ? 429
        : kind === "validation" || kind === "auth"
        ? 401
        : 503;
      return safeError(id, origin, status);
    }
  });
}

if (import.meta.main) Deno.serve((request) => loginHandler(request));
