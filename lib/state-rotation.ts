import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const CONFIG_KEY = "discovery_state_rotation";

// Get the next state to search
export async function getNextState(): Promise<string> {
  try {
    // Try to get from supabase config table
    const { data, error } = await supabase
      .from("lead_discovery_config")
      .select("last_state_index")
      .eq("key", CONFIG_KEY)
      .single();

    let stateIndex = data?.last_state_index || 0;
    const nextIndex = (stateIndex + 1) % US_STATES.length;

    // Update the index
    if (data) {
      await supabase
        .from("lead_discovery_config")
        .update({ last_state_index: nextIndex, updated_at: new Date().toISOString() })
        .eq("key", CONFIG_KEY);
    } else {
      await supabase.from("lead_discovery_config").insert({
        key: CONFIG_KEY,
        last_state_index: nextIndex,
        updated_at: new Date().toISOString(),
      });
    }

    return US_STATES[nextIndex];
  } catch (error) {
    console.error("State rotation error:", error);
    return US_STATES[Math.floor(Math.random() * US_STATES.length)];
  }
}

// Get multiple states for batch discovery
export async function getNextStates(count: number): Promise<string[]> {
  const states: string[] = [];
  for (let i = 0; i < count; i++) {
    const state = await getNextState();
    states.push(state);
  }
  return states;
}

export function getAllStates(): string[] {
  return US_STATES;
}

// Curated metros with strong OpenStreetMap coverage, so every discovery run
// lands somewhere that actually has HVAC businesses to find (state rotation
// alone can hit sparse states and return nothing).
const METRO_TARGETS: { city: string; state: string }[] = [
  { city: "Phoenix", state: "AZ" }, { city: "Los Angeles", state: "CA" },
  { city: "Houston", state: "TX" }, { city: "Chicago", state: "IL" },
  { city: "Miami", state: "FL" }, { city: "Philadelphia", state: "PA" },
  { city: "San Diego", state: "CA" }, { city: "Dallas", state: "TX" },
  { city: "Columbus", state: "OH" }, { city: "Atlanta", state: "GA" },
  { city: "Charlotte", state: "NC" }, { city: "San Antonio", state: "TX" },
  { city: "Austin", state: "TX" }, { city: "Tucson", state: "AZ" },
];
const METRO_KEY = "discovery_metro_rotation";

// Return the next `count` metros to search, advancing a persisted rotation
// counter so repeat runs cover new cities (and find new leads).
export async function getNextMetros(count: number): Promise<{ city: string; state: string }[]> {
  let idx = 0;
  try {
    const { data } = await supabase
      .from("lead_discovery_config")
      .select("id, last_state_index")
      .eq("key", METRO_KEY)
      .maybeSingle();
    idx = data?.last_state_index ?? 0;

    const out: { city: string; state: string }[] = [];
    for (let i = 0; i < count; i++) out.push(METRO_TARGETS[(idx + i) % METRO_TARGETS.length]);
    const nextIdx = (idx + count) % METRO_TARGETS.length;

    if (data) {
      await supabase
        .from("lead_discovery_config")
        .update({ last_state_index: nextIdx, updated_at: new Date().toISOString() })
        .eq("id", data.id);
    } else {
      await supabase.from("lead_discovery_config").insert({
        key: METRO_KEY,
        last_state_index: nextIdx,
        updated_at: new Date().toISOString(),
      });
    }
    return out;
  } catch (error) {
    console.error("Metro rotation error:", error);
    // Fail safe: always return at least one high-coverage metro.
    return Array.from({ length: count }, (_, i) => METRO_TARGETS[i % METRO_TARGETS.length]);
  }
}
