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
    { auth: { persistSession: false } }
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
 * Every query through this helper is filtered by tenant_id. Reads and writes
 * both — an insert without the tenant stamped is the same leak as a read.
 */
export function tenantScope(tenantId: string) {
  const db = serviceClient();
  return {
    from(table: string) {
      return {
        select: (columns = "*") => db.from(table).select(columns).eq("tenant_id", tenantId),
        insert: <T extends Record<string, unknown>>(rows: T | T[]) =>
          db.from(table).insert(
            (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, tenant_id: tenantId }))
          ),
        update: <T extends Record<string, unknown>>(patch: T) =>
          db.from(table).update(patch).eq("tenant_id", tenantId),
        delete: () => db.from(table).delete().eq("tenant_id", tenantId),
      };
    },
  };
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
