import { bytea, rpc, serviceDb } from "../_shared/db.ts";
import { argon2id } from "npm:hash-wasm@4.12.0";
import { hmac } from "../_shared/crypto.ts";
import {
  consumeEndpointLimit,
  failureClass,
  json,
  readJsonBody,
  requestId,
  requireSessionProxy,
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
type CreatedUserRow = UserRow & { status: string };
const safeUsers = async (id: string | null = null) => {
  const { data, error } = await serviceDb().rpc("list_safe_users", {
    p_id: id,
    p_role: null,
  });
  if (error) throw new Error("safe user read failed");
  return data as UserRow[];
};

export type UsersDependencies = {
  id: () => string;
  verify: typeof verifySession;
  safeUsers: typeof safeUsers;
  list: () => Promise<UserRow[]>;
  create: (input: Record<string, unknown>) => Promise<CreatedUserRow>;
  rpc: typeof rpc;
  hash: typeof argon2id;
  hmac: typeof hmac;
  uuid: () => string;
  random: (array: Uint8Array) => Uint8Array;
  logger: SafeLogger;
  now: () => number;
};

const dependencies: UsersDependencies = {
  id: requestId,
  verify: verifySession,
  safeUsers,
  list: () => safeUsers(),
  create: async (input) => {
    const { data, error } = await serviceDb().rpc(
      "session_create_user_authorized",
      input,
    );
    if (error || !data?.[0]) throw new Error("database operation failed");
    return data[0] as CreatedUserRow;
  },
  rpc,
  hash: argon2id,
  hmac,
  uuid: () => crypto.randomUUID(),
  random: (array) => crypto.getRandomValues(array),
  logger: safeLogger,
  now: () => performance.now(),
};

export async function usersHandler(
  request: Request,
  deps: UsersDependencies = dependencies,
) {
  const origin = request.headers.get("origin");
  const endpoint = request.method === "GET" ? "list-users" : "create-user";
  return withCompletionTelemetry(request, endpoint, deps, async (id) => {
    if (request.method !== "GET" && request.method !== "POST") {
      return safeError(id, origin, 405);
    }
    try {
      await requireSessionProxy(request);
    } catch {
      return safeError(id, origin, 401);
    }
    try {
      const actor = await deps.verify(bearer(request));
      if (request.method === "GET") {
        await consumeEndpointLimit(
          "list-users",
          [actor.sub, actor.session],
          60,
          30,
          deps.rpc,
        );
        const current = await deps.safeUsers(actor.sub);
        if (current[0]?.role !== "LIDER_REPASO") {
          return safeError(id, origin, 403);
        }
        return json({ users: await deps.list() }, 200, origin);
      }
      const operationId = request.headers.get("idempotency-key");
      if (operationId === null) return safeError(id, origin, 400);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(operationId)
      ) return safeError(id, origin, 422);
      const input = await readJsonBody<unknown>(request);
      if (
        !input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) =>
          !["firstName", "lastName", "role", "defaultInstrument"].includes(key)
        )
      ) return safeError(id, origin, 400);
      const { firstName, lastName, role, defaultInstrument } = input as Record<
        string,
        unknown
      >;
      if (
        typeof firstName !== "string" || !firstName.trim() ||
        typeof lastName !== "string" || !lastName.trim() ||
        typeof role !== "string" ||
        !["GENERAL", "LIDER_REPASO"].includes(role) ||
        (defaultInstrument !== undefined &&
          typeof defaultInstrument !== "string")
      ) return safeError(id, origin, 422);
      await consumeEndpointLimit(
        "create-user",
        [actor.sub, actor.session],
        60,
        10,
        deps.rpc,
      );
      const accessCode = Array.from(
        await deps.hmac(`create-user:${operationId}`),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("").slice(0, 12);
      const actorId = deps.uuid();
      const hash = await deps.hash({
        password: accessCode,
        salt: deps.random(new Uint8Array(16)),
        parallelism: 1,
        iterations: 3,
        memorySize: 65536,
        hashLength: 32,
        outputType: "encoded",
      });
      const data = await deps.create({
        p_caller_actor_id: actor.sub,
        p_caller_session_id: actor.session,
        p_operation_id: operationId,
        p_actor_id: actorId,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_role: role,
        p_default_instrument: typeof defaultInstrument === "string"
          ? defaultInstrument.trim() || null
          : null,
        p_lookup_hash: bytea(await deps.hmac(`lookup:${accessCode}`)),
        p_access_code_hash: hash,
      });
      if (data.status === "forbidden") return safeError(id, origin, 403);
      if (data.status === "conflict") return safeError(id, origin, 409);
      if (!data.id || !["created", "repeated"].includes(data.status)) {
        throw new Error("database operation failed");
      }
      const created: UserRow = {
        id: data.id,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role,
        default_instrument: data.default_instrument,
      };
      const response = json({ user: created, accessCode }, 201, origin);
      response.headers.set("Idempotency-Key", operationId);
      response.headers.set("Access-Control-Expose-Headers", "Idempotency-Key");
      return response;
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

if (import.meta.main) Deno.serve((request) => usersHandler(request));
