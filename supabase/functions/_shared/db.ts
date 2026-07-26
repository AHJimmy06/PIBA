import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { bytesToBase64 } from "./crypto.ts";

export const serviceDb = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing service configuration");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await serviceDb().rpc(name, args);
  if (error) throw new Error("database operation failed");
  return data as T;
}

export const bytea = (value: Uint8Array) => bytesToBase64(value);
