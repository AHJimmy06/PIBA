const text = new TextEncoder();

export const sha256 = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(value)));

export async function hmac(value: string): Promise<Uint8Array> {
  const secret = Deno.env.get('PIBA_SESSION_PEPPER');
  if (!secret) throw new Error('missing secret');
  const key = await crypto.subtle.importKey('raw', text.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(value)));
}

export const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
