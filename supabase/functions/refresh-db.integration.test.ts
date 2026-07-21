import { assertEquals } from "jsr:@std/assert@1.0.8";
import { refreshHandler } from "./session-refresh/index.ts";
import { profileHandler } from "./session-profile/index.ts";

const container = Deno.env.get("PIBA_SESSION_DB_CONTAINER");
const apiKey = "integration-anon-key";
const proxySecret = "integration-proxy-secret";

const sql = async (script: string, variables: Record<string, string> = {}) => {
  const args = [
    "exec",
    "-i",
    container!,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "piba_session_harness",
    "-XAt",
    "-F",
    "|",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-v", `${name}=${value}`);
  }
  const command = new Deno.Command("docker", {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = command.stdin.getWriter();
  await writer.write(new TextEncoder().encode(script));
  await writer.close();
  const output = await command.output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

Deno.test({
  name:
    "refresh handler replay commits family revocation and rejects old and successor on protected handlers",
  ignore: !container,
  fn: async () => {
    Deno.env.set("SUPABASE_ANON_KEY", apiKey);
    Deno.env.set("PIBA_PROXY_SECRET", proxySecret);
    const actor = await sql(
      "select id from public.users order by id limit 1;\n",
    );
    if (!uuidPattern.test(actor)) throw new Error("invalid fixture actor id");
    const initialSession = crypto.randomUUID();
    const initialFamily = crypto.randomUUID();
    const initialExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const issued = (await sql(
      "select session_id,family_id,expires_at from app_private.finalize_login(:'actor'::uuid,1,(select access_code_lookup_hash from app_private.user_credentials where actor_id=:'actor'::uuid),'$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture-hash-value-32-bytes',null,:'session_id'::uuid,:'family_id'::uuid,extensions.digest('handler-old','sha256'),:'expires_at'::timestamptz);\n",
      {
        actor,
        session_id: initialSession,
        family_id: initialFamily,
        expires_at: initialExpiry,
      },
    )).split("|");
    const claims = {
      sub: actor,
      jti: "handler-old",
      family: issued[1],
      session: issued[0],
    };
    let nextIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const rpc = async <T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> => {
      if (name === "consume_endpoint_limit") return true as T;
      if (name === "session_refresh_status") {
        const row = await sql(
          "select status,coalesce(session_id::text,''),coalesce(family_id::text,''),coalesce(actor_id::text,''),coalesce(jti::text,''),coalesce(issued_at::text,''),coalesce(expires_at::text,'') from app_private.refresh_operation_status(decode(:'old_hash','base64'),:'operation_id'::uuid);\n",
          {
            old_hash: String(args.p_old_jti_hash),
            operation_id: String(args.p_operation_id),
          },
        );
        const [
          status,
          session_id,
          family_id,
          actor_id,
          jti,
          issued_at,
          expires_at,
        ] = row.split("|");
        return [{
          status,
          session_id,
          family_id,
          actor_id,
          jti,
          issued_at,
          expires_at,
        }] as T;
      }
      if (name !== "session_rotate") throw new Error("unexpected RPC");
      const oldHash = String(args.p_old_jti_hash);
      const newHash = String(args.p_new_jti_hash);
      const newSessionId = String(args.p_new_session_id);
      const expiresAt = String(args.p_new_expires_at);
      if (
        !base64Pattern.test(oldHash) || !base64Pattern.test(newHash) ||
        !uuidPattern.test(newSessionId)
      ) {
        throw new Error("invalid generated refresh identifiers");
      }
      const row = await sql(
        "select status,coalesce(session_id::text,''),coalesce(family_id::text,''),coalesce(actor_id::text,''),coalesce(jti::text,''),coalesce(issued_at::text,''),coalesce(expires_at::text,'') from app_private.rotate_session(decode(:'old_hash','base64'),:'operation_id'::uuid,:'session_id'::uuid,:'jti'::uuid,decode(:'new_hash','base64'),:'expires_at'::timestamptz);\n",
        {
          old_hash: oldHash,
          operation_id: String(args.p_operation_id),
          session_id: newSessionId,
          jti: String(args.p_new_jti),
          new_hash: newHash,
          expires_at: expiresAt,
        },
      );
      const [
        status,
        session_id,
        family_id,
        actor_id,
        jti,
        issued_at,
        expires_at,
      ] = row.split("|");
      return [{
        status,
        session_id,
        family_id,
        actor_id,
        jti,
        issued_at,
        expires_at,
      }] as T;
    };
    const hash = async (value: string) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      );
    const deps = {
      id: () => "request-1",
      verify: async () => claims,
      hash,
      rpc,
      issue: async (
        actor: string,
        family: string,
        session: string,
        jti: string,
        expiresAt?: string,
        issuedAt?: string,
      ) => [actor, family, session, jti, expiresAt, issuedAt].join(":"),
      uuid: () => nextIds.shift()!,
      expiresAt: () => new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      logger: () => undefined,
      now: () => 0,
    };
    let operationId = crypto.randomUUID();
    const request = () =>
      new Request("http://localhost/refresh", {
        method: "POST",
        headers: {
          apikey: apiKey,
          "x-piba-proxy-secret": proxySecret,
          authorization: "Bearer old-token",
          "x-piba-operation-id": operationId,
        },
      });

    const firstBody = await (await refreshHandler(request(), deps)).json();
    nextIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const retry = await refreshHandler(request(), deps);
    assertEquals(retry.status, 200);
    assertEquals(await retry.json(), firstBody);
    assertEquals(
      await sql(
        "select count(*) from app_private.session_families where id=:'family_id'::uuid and revoked_at is null;\n",
        { family_id: claims.family },
      ),
      "1",
    );

    operationId = crypto.randomUUID();
    nextIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    assertEquals((await refreshHandler(request(), deps)).status, 401);
    assertEquals(
      await sql(
        "select count(*) from app_private.session_families where id=:'family_id'::uuid and revoked_at is not null;\n",
        { family_id: claims.family },
      ),
      "1",
    );

    const protectedStatus = async (jti: string) => {
      const verify = async () => {
        if (
          await sql(
            "select count(*) from app_private.validate_session(extensions.digest(:'jti','sha256'));\n",
            { jti },
          ) !== "1"
        ) throw new Error("invalid token");
        return claims;
      };
      return (await profileHandler(
        new Request("http://localhost/profile", {
          headers: {
            apikey: apiKey,
            authorization: "Bearer token",
            "x-piba-proxy-secret": proxySecret,
          },
        }),
        {
          id: () => "request-1",
          verify,
          rpc: (async () => true) as never,
          read: async () => {
            throw new Error("must not read");
          },
          update: async () => {
            throw new Error("must not update");
          },
          logger: () => undefined,
          now: () => 0,
        },
      )).status;
    };
    assertEquals(await protectedStatus("handler-old"), 401);
    assertEquals(await protectedStatus(firstBody.token.split(":")[3]), 401);
  },
});
