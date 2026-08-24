import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation.
//
// The service-role client BYPASSES RLS. That is required for cron and webhooks,
// but it means server code is the last line of defence against a cross-tenant
// leak. Never hand raw `serviceClient()` to request-scoped code — use
// `tenantScope()`, which forces a tenant_id filter onto every query.
// ─────────────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  plan: "solo" | "company";
  status: "pending" | "active" | "past_due" | "cancelled";
  setup_fee_paid: boolean;
  seat_limit: number;
  niche_limit: number;
  inbox_limit: number;
  monthly_lead_cap: number;
  monthly_send_cap: number;
}

export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      // Next caches supabase-js's INTERNAL fetch, so `export const dynamic =
      // "force-dynamic"` on the route is not enough on its own — the client
      // happily replays a cached response and the CRM shows counts that are
      // minutes stale. Routes like crm/stats already pass this exact override;
      // it has to live here too, or migrating them to tenantScope() would
      // silently reintroduce the bug those routes were fixed for.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}

/** Resolve the tenant for a signed-in Supabase user. */
export async function tenantForUser(userId: string): Promise<Tenant | null> {
  const db = serviceClient();
  const { data: member } = await db
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!member?.tenant_id) return null;

  const { data: tenant } = await db
    .from("tenants")
    .select("id, name, plan, status, setup_fee_paid, seat_limit, niche_limit, inbox_limit, monthly_lead_cap, monthly_send_cap")
    .eq("id", member.tenant_id)
    .maybeSingle();
  return (tenant as Tenant | null) ?? null;
}

/**
 * Strip any caller-supplied tenant_id.
 *
 * The scope stamps the tenant itself. If a patch were allowed to carry its own
 * tenant_id, a request body echoed into an update could move a row into another
 * tenant — a write leak that the `.eq("tenant_id")` filter does not catch,
 * because the filter selects which rows change, not what they become.
 */
function stripTenantId<T extends Record<string, unknown>>(row: T): Omit<T, "tenant_id"> {
  const { tenant_id: _ignored, ...rest } = row as T & { tenant_id?: unknown };
  return rest as Omit<T, "tenant_id">;
}

/**
 * supabase-js infers row types from a *literal* table name. `tenantScope` takes
 * a widened `string`, so inference collapses to `GenericStringError[]` and every
 * caller's `.data` becomes unusable — `lead.status` stops type-checking even
 * though the query is correct.
 *
 * The client is constructed without a `Database` generic, so the schema is
 * already `any` and no real type information exists to lose. Widening the
 * builder restores exactly the ergonomics routes had before the migration.
 * Replacing this with generated Supabase types is the proper fix and is worth
 * doing once the routes are migrated — it would catch column typos across all
 * 38 of them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScopedBuilder = any;

/**
 * Every query through this helper is filtered by tenant_id. Reads and writes
 * both — an insert without the tenant stamped is the same leak as a read.
 */
export function tenantScope(tenantId: string) {
  const db = serviceClient();
  const stamp = <T extends Record<string, unknown>>(rows: T | T[]) =>
    (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      ...stripTenantId(row),
      tenant_id: tenantId,
    }));

  return {
    from(table: string) {
      return {
        /**
         * `options` is passed straight through so `{ count: "exact", head: true }`
         * keeps working. Without it every count query in the CRM would silently
         * turn into a full row fetch and `.count` would come back null.
         */
        select: (
          columns = "*",
          options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }
        ): ScopedBuilder => db.from(table).select(columns, options).eq("tenant_id", tenantId),
        insert: <T extends Record<string, unknown>>(rows: T | T[]): ScopedBuilder =>
          db.from(table).insert(stamp(rows)),
        /**
         * `onConflict` mirrors supabase-js. The tenant is stamped on every row,
         * so an upsert can create or update but never cross a tenant boundary.
         */
        upsert: <T extends Record<string, unknown>>(
          rows: T | T[],
          options?: { onConflict?: string; ignoreDuplicates?: boolean }
        ): ScopedBuilder => db.from(table).upsert(stamp(rows), options),
        update: <T extends Record<string, unknown>>(patch: T): ScopedBuilder =>
          db.from(table).update(stripTenantId(patch)).eq("tenant_id", tenantId),
        delete: (): ScopedBuilder => db.from(table).delete().eq("tenant_id", tenantId),
      };
    },
  };
}

// ── Request-scoped tenant resolution ────────────────────────────────────────

/** Thrown when a request cannot be attributed to exactly one active tenant. */
export class TenantResolutionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TenantResolutionError";
  }
}

/**
 * The tenant for an authenticated request, or a throw. Never returns null:
 * a route that cannot name its tenant must fail, not fall back to "all rows".
 *
 * `founderTenantId` exists because the operator's own login is the pre-SaaS
 * APP_USERNAME/APP_PASSWORD session (lib/session.ts), which has no Supabase
 * user and therefore no tenant_members row. It maps to the founding tenant
 * created by the 011 backfill.
 */
export async function requireTenant(req: Request): Promise<Tenant> {
  const { SESSION_COOKIE, verifySessionToken } = await import("@/lib/session");

  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (await verifySessionToken(cookie)) {
    const founder = await founderTenant();
    if (!founder) throw new TenantResolutionError("Founding tenant not provisioned", 500);
    return founder;
  }

  throw new TenantResolutionError("Not signed in", 401);
}

/** The tenant that owns everything created before multi-tenancy existed. */
export async function founderTenant(): Promise<Tenant | null> {
  const { data } = await serviceClient()
    .from("tenants")
    .select("id, name, plan, status, setup_fee_paid, seat_limit, niche_limit, inbox_limit, monthly_lead_cap, monthly_send_cap")
    .eq("is_founding", true)
    .maybeSingle();
  return (data as Tenant | null) ?? null;
}

/** An active tenant may act; anything else is read-only or locked out. */
export function assertTenantActive(tenant: Tenant): void {
  if (tenant.status !== "active") {
    throw new TenantResolutionError(`Tenant is ${tenant.status}`, 402);
  }
}

// ── Bring your own AI ───────────────────────────────────────────────────────
// Provider keys always come from the tenant's own stored secrets. Our keys are
// never injected into a tenant's runtime.
export async function tenantSecrets(tenantId: string, kind: string): Promise<Record<string, string>> {
  const { data } = await serviceClient()
    .from("tenant_secrets")
    .select("name, value")
    .eq("tenant_id", tenantId)
    .eq("kind", kind);
  const out: Record<string, string> = {};
  for (const row of (data as Array<{ name: string; value: string }> | null) ?? []) {
    out[row.name] = row.value;
  }
  return out;
}

// ── Metering ────────────────────────────────────────────────────────────────
export type UsageMetric = "leads_discovered" | "emails_sent" | "places_requests";

/**
 * Reserve one unit of a metered resource. Returns false when the tenant is at
 * its cap, so the caller skips the work entirely rather than paying for it.
 * Mirrors the existing DB-enforced Google quota pattern.
 *
 * ⚠️ NOT ATOMIC. This reads the counter, then writes it back. Two concurrent
 * requests can both read `used = cap - 1` and both write `cap`, so a tenant can
 * overshoot by roughly the number of in-flight requests. That is tolerable for
 * discovery (a few extra Places calls) and NOT tolerable for `emails_sent`,
 * where the overshoot is real mail against a paid cap.
 *
 * The fix is a Postgres function doing `UPDATE ... SET used = used + 1 WHERE
 * used < cap RETURNING used`, which decides the race inside the database. That
 * belongs in the migration that creates tenant_usage; until then, do not rely
 * on this as the only send-side limit — the existing DAILY_SEND_CAP count in
 * lib/automation.ts still applies and is checked separately.
 */
export async function reserveUsage(
  tenantId: string,
  metric: UsageMetric,
  cap: number,
  periodKey: string = new Date().toISOString().slice(0, 7)
): Promise<boolean> {
  const db = serviceClient();
  const { data, error } = await db
    .from("tenant_usage")
    .select("id, used, cap")
    .eq("tenant_id", tenantId)
    .eq("period_key", periodKey)
    .eq("metric", metric)
    .maybeSingle();

  // Fail closed: if the counter cannot be read, do not spend the resource.
  if (error) return false;

  if (!data) {
    const { error: insertError } = await db
      .from("tenant_usage")
      .insert({ tenant_id: tenantId, period_key: periodKey, metric, used: 1, cap });
    return !insertError;
  }
  if ((data.used ?? 0) >= (data.cap ?? cap)) return false;

  const { error: updateError } = await db
    .from("tenant_usage")
    .update({ used: (data.used ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  return !updateError;
}

/** Give a reserved unit back when the work did not happen. */
export async function releaseUsage(
  tenantId: string,
  metric: UsageMetric,
  periodKey: string = new Date().toISOString().slice(0, 7)
): Promise<void> {
  const db = serviceClient();
  const { data } = await db
    .from("tenant_usage")
    .select("id, used")
    .eq("tenant_id", tenantId)
    .eq("period_key", periodKey)
    .eq("metric", metric)
    .maybeSingle();
  if (!data || (data.used ?? 0) <= 0) return;
  await db.from("tenant_usage").update({ used: data.used - 1 }).eq("id", data.id);
}

export const PLAN_LIMITS = {
  solo: { seat_limit: 1, niche_limit: 1, inbox_limit: 1, monthly_lead_cap: 500, monthly_send_cap: 1000 },
  company: { seat_limit: 5, niche_limit: 5, inbox_limit: 5, monthly_lead_cap: 2500, monthly_send_cap: 5000 },
} as const;
