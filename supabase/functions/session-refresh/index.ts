import { bytea, rpc } from "../_shared/db.ts";
import { sha256 } from "../_shared/crypto.ts";
import {
  consumeIpAndFamilyLimits,
  failureClass,
  json,
  requestId,
  requireSessionProxy,
  safeError,
  type SafeLogger,
  safeLogger,
  withCompletionTelemetry,
} from "../_shared/http.ts";
import {
  bearer,
  issueSession,
  verifySignedSession,
} from "../_shared/session.ts";

export type RefreshDependencies = {
  id: () => string;
  verify: typeof verifySignedSession;
  hash: typeof sha256;
  rpc: typeof rpc;
  issue: typeof issueSession;
  uuid: () => string;
  logger: SafeLogger;
  now: () => number;
  expiresAt: () => string;
};
type RefreshRow = {
  status: string;
  session_id: string;
  family_id: string;
  actor_id: string;
  jti: string;
  issued_at: string;
  expires_at: string;
};
const dependencies: RefreshDependencies = {
  id: requestId,
  verify: verifySignedSession,
  hash: sha256,
  rpc,
  issue: issueSession,
  uuid: () => crypto.randomUUID(),
  logger: safeLogger,
  now: () => performance.now(),
  expiresAt: () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
};

export async function refreshHandler(
  request: Request,
  deps: RefreshDependencies = dependencies,
) {
  const origin = request.headers.get("origin");
  return withCompletionTelemetry(request, "refresh", deps, async (id) => {
    if (request.method !== "POST") return safeError(id, origin, 405);
    try {
      await requireSessionProxy(request);
    } catch {
      return safeError(id, origin, 401);
    }
    try {
      const old = await deps.verify(bearer(request));
      const operationId = request.headers.get("x-piba-operation-id");
      if (
        !operationId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(operationId)
      ) {
        return safeError(id, origin, 400);
      }
      const oldJtiHash = bytea(await deps.hash(old.jti));
      const statusRows = await deps.rpc<RefreshRow[]>(
        "session_refresh_status",
        {
          p_old_jti_hash: oldJtiHash,
          p_operation_id: operationId,
        },
      );
      const prior = statusRows[0];
      if (prior?.status === "repeated") {
        const token = await deps.issue(
          prior.actor_id,
          prior.family_id,
          prior.session_id,
          prior.jti,
          prior.expires_at,
          prior.issued_at,
        );
        return json({ token, expiresAt: prior.expires_at }, 200, origin);
      }
      if (prior?.status === "replay") {
        const replayJti = deps.uuid();
        const replay = await deps.rpc<RefreshRow[]>("session_rotate", {
          p_old_jti_hash: oldJtiHash,
          p_operation_id: operationId,
          p_new_session_id: deps.uuid(),
          p_new_jti: replayJti,
          p_new_jti_hash: bytea(await deps.hash(replayJti)),
          p_new_expires_at: deps.expiresAt(),
        });
        if (replay[0]?.status === "replay_revoked") {
          return safeError(
            id,
            origin,
            401,
            "refresh_replay_family_revoked",
          );
        }
        return safeError(id, origin, 401);
      }
      if (prior?.status !== "fresh") return safeError(id, origin, 401);
      await consumeIpAndFamilyLimits(
        request,
        "refresh",
        old.family,
        20,
        10,
        deps.rpc,
      );
      const jti = deps.uuid();
      const sessionId = deps.uuid();
      const expiresAt = deps.expiresAt();
      const rows = await deps.rpc<RefreshRow[]>("session_rotate", {
        p_old_jti_hash: oldJtiHash,
        p_operation_id: operationId,
        p_new_session_id: sessionId,
        p_new_jti: jti,
        p_new_jti_hash: bytea(await deps.hash(jti)),
        p_new_expires_at: expiresAt,
      });
      const result = rows[0];
      if (result?.status === "replay_revoked") {
        return safeError(id, origin, 401, "refresh_replay_family_revoked");
      }
      if (!result || !["rotated", "repeated"].includes(result.status)) {
        return safeError(id, origin, 401);
      }
      const token = await deps.issue(
        result.actor_id,
        result.family_id,
        result.session_id,
        result.jti,
        result.expires_at,
        result.issued_at,
      );
      const response = json(
        {
          token,
          expiresAt: result.expires_at,
        },
        200,
        origin,
      );
      return response;
    } catch (error) {
      const kind = failureClass(error);
      const status = kind === "rate_limit" ? 429 : kind === "auth" ? 401 : 503;
      return safeError(id, origin, status);
    }
  });
}

if (import.meta.main) Deno.serve((request) => refreshHandler(request));
