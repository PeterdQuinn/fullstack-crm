import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_LOCATIONS, discoveryTerms } from "@/lib/targeting";
export const dynamic = "force-dynamic";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  const [settings, runs, outbox] = await Promise.all([
    db.from("automation_settings").select("*").eq("id", "owner").single(),
    db.from("automation_runs").select("*").order("started_at", { ascending: false }).limit(30),
    db.from("email_outbox").select("id,recipient,subject,status,attempts,error_message,created_at,accepted_at,finalized_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const error = settings.error || runs.error || outbox.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: { ...settings.data, locations: settings.data.locations.length ? settings.data.locations : DEFAULT_LOCATIONS }, runs: runs.data, outbox: outbox.data });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body.enabled !== "boolean" || !Array.isArray(body.niches) || !body.niches.length || body.niches.length > 100) throw new Error("Choose at least one niche (maximum 100)");
    const niches = [...new Set(body.niches.map((n: unknown) => { if (typeof n !== "string") throw new Error("Invalid niche"); return discoveryTerms(n).niche; }))];
    if (!Array.isArray(body.locations) || !body.locations.length || body.locations.length > 100) throw new Error("Choose at least one US city and state (maximum 100)");
    const locations = body.locations.map((l: any) => {
      if (typeof l.city !== "string" || !l.city.trim() || l.city.length > 80 || !/^[A-Z]{2}$/.test(l.state)) throw new Error("Locations need a city and two-letter state");
      return { city: l.city.trim(), state: l.state };
    });
    const { data, error } = await db.from("automation_settings").update({ enabled: body.enabled, niches, locations, cursor: 0, updated_at: new Date().toISOString() }).eq("id", "owner").select("*").single();
    if (error) throw new Error(`Settings were not saved: ${error.message}`);
    return NextResponse.json({ settings: data });
  } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
