import { bytea, rpc } from "../_shared/db.ts";
import { sha256 } from "../_shared/crypto.ts";
import {
  consumeIpAndFamilyLimits,
  failureClass,
  json,
  requestId,
  requireProjectApiKey,
  safeError,
  type SafeLogger,
  safeLogger,
  withCompletionTelemetry,
} from "../_shared/http.ts";
import { bearer, verifySession } from "../_shared/session.ts";

export type LogoutDependencies = {
  id: () => string;
  verify: typeof verifySession;
  hash: typeof sha256;
  rpc: typeof rpc;
  logger: SafeLogger;
  now: () => number;
};
const dependencies: LogoutDependencies = {
  id: requestId,
  verify: verifySession,
  hash: sha256,
  rpc,
  logger: safeLogger,
  now: () => performance.now(),
};

export async function logoutHandler(
  request: Request,
  deps: LogoutDependencies = dependencies,
) {
  const origin = request.headers.get("origin");
  return withCompletionTelemetry(request, "logout", deps, async (id) => {
    if (request.method !== "POST") return safeError(id, origin, 405);
    try {
      await requireProjectApiKey(request);
    } catch {
      return safeError(id, origin, 401);
    }
    try {
      const claims = await deps.verify(bearer(request));
      await consumeIpAndFamilyLimits(
        request,
        "logout",
        claims.family,
        30,
        10,
        deps.rpc,
      );
      await deps.rpc("session_revoke", {
        p_jti_hash: bytea(await deps.hash(claims.jti)),
        p_reason: "logout",
      });
      return json({ ok: true, requestId: id }, 200, origin);
    } catch (error) {
      const kind = failureClass(error);
      const status = kind === "rate_limit" ? 429 : kind === "auth" ? 401 : 503;
      return json(
        { error: "Revocation unresolved", requestId: id },
        status,
        origin,
      );
    }
  });
}

if (import.meta.main) Deno.serve((request) => logoutHandler(request));
