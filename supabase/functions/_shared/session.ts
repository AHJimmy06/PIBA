import { importJWK, jwtVerify, SignJWT } from "npm:jose@6.2.3";
import { bytea, rpc } from "./db.ts";
import { sha256 } from "./crypto.ts";

type Claims = { sub: string; jti: string; family: string; session: string };

const privateKey = async () =>
  importJWK(
    JSON.parse(Deno.env.get("PIBA_SESSION_PRIVATE_JWK") ?? ""),
    "ES256",
  );
const publicKey = async () =>
  importJWK(JSON.parse(Deno.env.get("PIBA_SESSION_PUBLIC_JWK") ?? ""), "ES256");

export async function assertSessionSigning(): Promise<void> {
  await new SignJWT({ preflight: true }).setProtectedHeader({
    alg: "ES256",
    typ: "JWT",
  })
    .setIssuedAt().setExpirationTime("1m").sign(await privateKey());
}

export async function issueSession(
  actorId: string,
  familyId: string,
  sessionId: string,
  jti: string,
  expiresAt?: string,
  issuedAt?: string,
) {
  const token = new SignJWT({ family: familyId, session: sessionId })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setSubject(actorId).setJti(jti);
  if (issuedAt) token.setIssuedAt(Math.floor(Date.parse(issuedAt) / 1000));
  else token.setIssuedAt();
  return token
    .setExpirationTime(
      expiresAt ? Math.floor(Date.parse(expiresAt) / 1000) : "8h",
    ).sign(await privateKey());
}

export async function verifySignedSession(token: string): Promise<Claims> {
  const verified = await jwtVerify(token, await publicKey(), {
    algorithms: ["ES256"],
  });
  const { sub, jti, family, session } = verified.payload;
  if (
    typeof sub !== "string" || typeof jti !== "string" ||
    typeof family !== "string" || typeof session !== "string"
  ) throw new Error("invalid token");
  return { sub, jti, family, session };
}

export async function verifySession(token: string): Promise<Claims> {
  const claims = await verifySignedSession(token);
  const rows = await rpc<
    Array<{ actor_id: string; family_id: string; session_id: string }>
  >("session_validate", { p_jti_hash: bytea(await sha256(claims.jti)) });
  if (
    rows.length !== 1 || rows[0].actor_id !== claims.sub ||
    rows[0].family_id !== claims.family || rows[0].session_id !== claims.session
  ) throw new Error("invalid token");
  return claims;
}

export const bearer = (request: Request) => {
  const value = request.headers.get("authorization") ?? "";
  if (!value.startsWith("Bearer ") || value.length > 8192) {
    throw new Error("missing bearer");
  }
  return value.slice(7);
};
