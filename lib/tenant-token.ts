// Signed tenant tokens for the routes that have no session.
//
// Tracking pixels, unsubscribe links and the Resend webhook are opened by a
// recipient's mail client or POSTed by a third party. There is no cookie and no
// Supabase user, so the tenant cannot come from the login. The two options were:
//
//   (a) resolve the tenant from the lead_id / provider_message_id in the payload
//   (b) carry a signed tenant token in the URL
//
// (a) is less work but means anyone who guesses or enumerates a valid id can act
// on that tenant's rows -- and unsubscribe ids travel in plaintext through mail
// servers and link scanners. (b) was chosen: the token is HMAC-signed, so a
// forged or edited one is rejected before any query runs.
//
// Web Crypto (not node:crypto) so middleware and edge routes can verify too.
// Same construction as lib/session.ts, different secret and payload.

const encoder = new TextEncoder();

/** Query parameter carrying the token on tracking and unsubscribe URLs. */
export const TENANT_TOKEN_PARAM = "t";

function secret(): string {
  // Distinct from the session secret: a leaked tracking URL must not be usable
  // as a login, and rotating one must not silently invalidate the other.
  const base = process.env.TENANT_TOKEN_SECRET || process.env.CRON_SECRET || "";
  return `tenant-token:${base}`;
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

/**
 * `<tenantId>.<scope>.<hmac>`
 *
 * Deliberately has no expiry. An unsubscribe link must keep working years after
 * the message was sent -- CAN-SPAM requires the opt-out to remain functional,
 * and an expired token would turn a compliance guarantee into a dead link. The
 * token authorises only the narrow `scope` it names, never a general session.
 */
export async function createTenantToken(tenantId: string, scope: TokenScope): Promise<string> {
  const payload = `${tenantId}.${scope}`;
  return `${payload}.${await hmac(payload)}`;
}

/** What a token is allowed to do. Checked on use, not just on issue. */
export type TokenScope = "unsubscribe" | "tracking" | "webhook";

/**
 * The tenant id this token names, or null when the signature, shape or scope
 * does not match. Null must be treated as "reject", never as "unknown tenant,
 * carry on".
 */
export async function verifyTenantToken(
  token: string | undefined | null,
  expectedScope: TokenScope
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [tenantId, scope, signature] = parts;
  if (scope !== expectedScope) return null;
  if (!tenantId) return null;

  const expected = await hmac(`${tenantId}.${scope}`);

  // Constant-time compare: never leak how much of the signature matched.
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0 ? tenantId : null;
}
