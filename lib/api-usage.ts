import { createClient } from "@supabase/supabase-js";

// DB-backed API usage counters. Currently used to hard-cap Google Places calls
// at a fixed number per week. The counter is a real row in `lead_discovery_config`
// (reused to avoid a schema migration): one row per ISO-ish week, keyed by the
// UTC Monday date, with the request count stored in `last_state_index`.
//
// This is a genuine enforced cap — searchGooglePlaces() reserves a slot here
// BEFORE making any HTTP call, and makes no call at all when the cap is hit.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const GOOGLE_PLACES_WEEKLY_CAP = 20;

// Bucket key = the UTC-Monday date of the current week. Rolls over every Monday.
function currentWeekKey(now = new Date()): string {
  const dayFromMonday = (now.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayFromMonday)
  );
  return `google_places_usage_${monday.toISOString().slice(0, 10)}`;
}

export async function getGoogleQuota(): Promise<{
  used: number;
  cap: number;
  remaining: number;
  weekKey: string;
  error?: string;
}> {
  const weekKey = currentWeekKey();
  const { data, error } = await supabase
    .from("lead_discovery_config")
    .select("last_state_index")
    .eq("key", weekKey)
    .maybeSingle();
  // Fail-closed: if we can't read the counter, report 0 remaining so nothing
  // treats Google as available.
  if (error) {
    return { used: GOOGLE_PLACES_WEEKLY_CAP, cap: GOOGLE_PLACES_WEEKLY_CAP, remaining: 0, weekKey, error: error.message };
  }
  const used = data?.last_state_index ?? 0;
  return {
    used,
    cap: GOOGLE_PLACES_WEEKLY_CAP,
    remaining: Math.max(0, GOOGLE_PLACES_WEEKLY_CAP - used),
    weekKey,
  };
}

// Reserve one Google Places request slot for this week.
// Returns true ONLY when a slot was available AND the DB counter was
// successfully incremented. Any DB error → returns false (fail-closed) so a
// broken/missing counter can never allow uncapped, billable Google calls.
// Callers MUST NOT make the HTTP request when this returns false.
export async function reserveGoogleRequest(): Promise<boolean> {
  const weekKey = currentWeekKey();
  const { data, error } = await supabase
    .from("lead_discovery_config")
    .select("id, last_state_index")
    .eq("key", weekKey)
    .maybeSingle();

  if (error) {
    console.error(`Google quota check failed — blocking (fail-closed): ${error.message}`);
    return false;
  }

  const used = data?.last_state_index ?? 0;
  if (used >= GOOGLE_PLACES_WEEKLY_CAP) return false;

  if (data) {
    const { error: upErr } = await supabase
      .from("lead_discovery_config")
      .update({ last_state_index: used + 1, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (upErr) {
      console.error(`Google quota increment failed — blocking (fail-closed): ${upErr.message}`);
      return false;
    }
  } else {
    const { error: insErr } = await supabase.from("lead_discovery_config").insert({
      key: weekKey,
      last_state_index: 1,
      updated_at: new Date().toISOString(),
    });
    if (insErr) {
      console.error(`Google quota init failed — blocking (fail-closed): ${insErr.message}`);
      return false;
    }
  }
  return true;
}
