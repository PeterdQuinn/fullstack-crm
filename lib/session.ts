// Signed session cookie for the operator login.
//
// The CRM has always authenticated with APP_USERNAME / APP_PASSWORD over HTTP
// Basic. That still works, but a browser Basic prompt cannot be driven from a
// styled login form, so the form exchanges the same credentials for a signed
// cookie instead. Same secret, same single operator — only the transport is new.
//
// Web Crypto is used (not node:crypto) so middleware can verify this on the edge.

const encoder = new TextEncoder();

export const SESSION_COOKIE = "fscrm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  // Derived from credentials that already exist; no new env var to forget to set.
  return `${process.env.APP_PASSWORD || ""}:${process.env.CRON_SECRET || ""}`;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `<username>.<expiryMs>.<hmac>` — verified, not merely present. */
export async function createSessionToken(username: string): Promise<string> {
  const payload = `${username}.${Date.now() + SESSION_MAX_AGE * 1000}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [username, expiry, signature] = parts;
  const expected = await hmac(`${username}.${expiry}`);

  // Constant-time compare: never leak how much of the signature matched.
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch !== 0) return false;

  const expiresAt = Number(expiry);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
