import { rpc, serviceDb } from "../_shared/db.ts";
import {
  consumeEndpointLimit,
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
import { bearer, verifySession } from "../_shared/session.ts";

type UserRow = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  default_instrument: string | null;
};
export type ProfileDependencies = {
  id: () => string;
  verify: typeof verifySession;
  read: (actorId: string) => Promise<UserRow>;
  update: (
    actorId: string,
    input: {
      first_name: string;
      last_name: string;
      default_instrument: string | null;
    },
  ) => Promise<UserRow>;
  rpc: typeof rpc;
  logger: SafeLogger;
  now: () => number;
};
const dependencies: ProfileDependencies = {
  id: requestId,
  verify: verifySession,
  rpc,
  logger: safeLogger,
  now: () => performance.now(),
  read: async (actorId) => {
    const { data, error } = await serviceDb().rpc("list_safe_users", {
      p_id: actorId,
      p_role: null,
    });
    if (error || !data?.[0]) throw new Error("read failed");
    return data[0] as UserRow;
  },
  update: async (actorId, input) => {
    const { error } = await serviceDb().from("users").update(input).eq(
      "id",
      actorId,
    );
    if (error) throw new Error("update failed");
    return dependencies.read(actorId);
  },
};

export async function profileHandler(
  request: Request,
  deps: ProfileDependencies = dependencies,
) {
  const origin = request.headers.get("origin");
  const endpoint = request.method === "GET" ? "current-user" : "update-profile";
  return withCompletionTelemetry(request, endpoint, deps, async (id) => {
    if (request.method !== "GET" && request.method !== "POST") {
      return safeError(id, origin, 405);
    }
    try {
      await requireProjectApiKey(request);
    } catch {
      return safeError(id, origin, 401);
    }
    try {
      const actor = await deps.verify(bearer(request));
      await consumeEndpointLimit(
        request.method === "GET" ? "current-user" : "update-profile",
        [actor.sub, actor.session],
        60,
        request.method === "GET" ? 60 : 20,
        deps.rpc,
      );
      if (request.method === "GET") {
        return json({ user: await deps.read(actor.sub) }, 200, origin);
      }
      const input = await readJsonBody<unknown>(request);
      if (
        !input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) =>
          !["firstName", "lastName", "defaultInstrument"].includes(key)
        )
      ) return safeError(id, origin, 400);
      const { firstName, lastName, defaultInstrument } = input as Record<
        string,
        unknown
      >;
      if (
        typeof firstName !== "string" || !firstName.trim() ||
        typeof lastName !== "string" || !lastName.trim() ||
        (defaultInstrument !== undefined &&
          typeof defaultInstrument !== "string")
      ) return safeError(id, origin, 422);
      const user = await deps.update(actor.sub, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        default_instrument: typeof defaultInstrument === "string"
          ? defaultInstrument.trim() || null
          : null,
      });
      return json({ user }, 200, origin);
    } catch (error) {
      const kind = failureClass(error);
      const status = kind === "rate_limit"
        ? 429
        : kind === "auth"
        ? 401
        : kind === "validation"
        ? 400
        : 503;
      return safeError(id, origin, status);
    }
  });
}

if (import.meta.main) Deno.serve((request) => profileHandler(request));
