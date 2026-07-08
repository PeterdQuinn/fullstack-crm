import { createClient } from "@supabase/supabase-js";

// Append-only audit trail for lead field changes (primarily status). Every row
// records WHO made the change:
//   "owner"      — a change made through the CRM UI (the single human operator)
//   "automation" — a change made on its own by cron / the reply classifier /
//                  scoring / webhooks (no human in the loop)
//
// Writes go through the service-role client: RLS blocks the anon/browser key
// from inserting here, so client-side UI changes log via the /api/crm/log-status
// route rather than writing directly.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type AuditSource = "owner" | "automation";

export async function logStatusChange(opts: {
  leadId: string;
  from?: string | null;
  to?: string | null;
  source: AuditSource;
  field?: string; // defaults to "status"
}): Promise<void> {
  const { leadId, from = null, to = null, source, field = "status" } = opts;

  // Nothing actually changed — don't record a no-op row.
  if (from === to) return;

  try {
    const { error } = await supabase.from("status_audit_log").insert({
      lead_id: leadId,
      source,
      field_changed: field,
      old_value: from === undefined ? null : from,
      new_value: to === undefined ? null : to,
    });
    if (error) console.warn("status_audit_log insert failed (non-fatal):", error.message);
  } catch (err) {
    // Auditing must never break the underlying operation.
    console.warn("status_audit_log insert threw (non-fatal):", err);
  }
}
