// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for lead-derived counts / KPIs across the whole app.
//
// Every page and API route that needs a lead count or status breakdown must
// import from here. Do NOT re-implement "how many leads are new / called today /
// due for follow-up / booked today" anywhere else — if two places compute the
// same metric, they can drift. This module is the one definition.
//
// Pure functions, no React, no browser APIs → safe on both server and client,
// so /api/crm/stats (server) and the leads workspace (client) get identical logic.
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of lead fields any stat here can depend on. */
export interface LeadStatFields {
  status?: string | null;
  email?: string | null;
  phone?: string | null;
  opt_out?: boolean | null;
  bounced?: boolean | null;
  meeting_booked?: boolean | null;
  meeting_date?: string | null;
  created_at?: string | null;
  last_called_at?: string | null;
  next_follow_up_at?: string | null;
}

// Business runs in America/Phoenix (UTC-7, no DST) — using a fixed offset makes
// "today"/"this week" deterministic on the server (UTC) AND the client (local),
// so the dashboard and the leads page can never disagree on day boundaries.
const PHX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Integer day index for an instant, in Phoenix local time. */
export function phoenixDayIndex(iso?: string | null, ref: number = Date.now()): number {
  const ms = iso ? new Date(iso).getTime() : ref;
  return Math.floor((ms - PHX_OFFSET_MS) / 86_400_000);
}

function phoenixWeekday(ref: number = Date.now()): number {
  // 0 = Sunday … 6 = Saturday, in Phoenix local time.
  return new Date(ref - PHX_OFFSET_MS).getUTCDay();
}

export function isSameDayPhoenix(iso?: string | null, ref: number = Date.now()): boolean {
  if (!iso) return false;
  return phoenixDayIndex(iso, ref) === phoenixDayIndex(null, ref);
}

export function isThisWeekPhoenix(iso?: string | null, ref: number = Date.now()): boolean {
  if (!iso) return false;
  const today = phoenixDayIndex(null, ref);
  const weekStart = today - phoenixWeekday(ref); // Sunday start
  const idx = phoenixDayIndex(iso, ref);
  return idx >= weekStart && idx < weekStart + 7;
}

export function isPast(iso?: string | null, ref: number = Date.now()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < ref;
}

/** A follow-up that is overdue and still actionable (not booked / dead). */
export function isFollowUpDue(lead: LeadStatFields, ref: number = Date.now()): boolean {
  return (
    !!lead.next_follow_up_at &&
    isPast(lead.next_follow_up_at, ref) &&
    lead.status !== "Booked" &&
    lead.status !== "Dead"
  );
}

function hasValue(v?: string | null): boolean {
  return !!v && v !== "" && v !== "N/A";
}

// ── The KPI row shown on the leads workspace ────────────────────────────────
export interface LeadKpis {
  total: number;
  new: number;
  calledToday: number;
  calledThisWeek: number;
  followUps: number;
  booked: number;
  interested: number;
  dead: number;
}

export function computeLeadKpis(leads: LeadStatFields[], ref: number = Date.now()): LeadKpis {
  return {
    total: leads.length,
    new: leads.filter((l) => l.status === "New").length,
    calledToday: leads.filter((l) => isSameDayPhoenix(l.last_called_at, ref)).length,
    calledThisWeek: leads.filter((l) => isThisWeekPhoenix(l.last_called_at, ref)).length,
    followUps: leads.filter((l) => isFollowUpDue(l, ref)).length,
    booked: leads.filter((l) => l.status === "Booked").length,
    interested: leads.filter((l) => l.status === "Interested").length,
    dead: leads.filter((l) => l.status === "Dead").length,
  };
}

// ── Lead-derived numbers the dashboard needs ────────────────────────────────
const EMAIL_QUEUE_STATUSES = ["Ready for Outreach", "Email 1 Sent", "Email 2 Sent"];
const CALL_QUEUE_STATUSES = ["Call Needed", "Ready for Outreach"];

export interface LeadDashboardStats {
  emailQueue: number;
  callQueue: number;
  onboarding: number;
  meetingsToday: number;
  newLeads: number; // created since the start of yesterday
}

export function computeLeadDashboardStats(
  leads: LeadStatFields[],
  ref: number = Date.now()
): LeadDashboardStats {
  const today = phoenixDayIndex(null, ref);
  return {
    emailQueue: leads.filter(
      (l) =>
        l.opt_out !== true &&
        l.bounced !== true &&
        l.status !== "Do Not Contact" &&
        !!l.status &&
        EMAIL_QUEUE_STATUSES.includes(l.status) &&
        hasValue(l.email)
    ).length,
    callQueue: leads.filter(
      (l) => hasValue(l.phone) && !!l.status && CALL_QUEUE_STATUSES.includes(l.status)
    ).length,
    onboarding: leads.filter((l) => l.meeting_booked === true && l.opt_out !== true).length,
    meetingsToday: leads.filter(
      (l) => l.meeting_booked === true && phoenixDayIndex(l.meeting_date, ref) === today
    ).length,
    newLeads: leads.filter((l) => phoenixDayIndex(l.created_at, ref) >= today - 1).length,
  };
}
