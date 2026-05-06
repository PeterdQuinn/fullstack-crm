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
