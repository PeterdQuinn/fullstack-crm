import { createClient } from "@supabase/supabase-js";

export function insuranceDb() {
  const url = process.env.INSURANCE_SUPABASE_URL;
  const key = process.env.INSURANCE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Insurance Supabase credentials are not configured");
  return createClient(url, key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal || AbortSignal.timeout(8000) }) },
  });
}
export const INSURANCE_MONTHLY_CAP = 100;
export async function reserveInsuranceRequest(provider: "serpapi" | "ollama" | "gemini") {
  const { data, error } = await insuranceDb().rpc("reserve_insurance_request", {
    p_provider: provider, p_month: new Date().toISOString().slice(0, 7), p_cap: INSURANCE_MONTHLY_CAP,
  });
  if (error) throw new Error("Could not reserve insurance API usage; no provider request was made");
  return data === true;
}
