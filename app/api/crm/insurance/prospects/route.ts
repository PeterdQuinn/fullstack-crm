import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { insuranceDb, INSURANCE_MONTHLY_CAP } from "@/lib/insurance/db";
import { prospectInput, InsuranceInputError } from "@/lib/insurance/validation";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET() {
  const db = insuranceDb();
  const [prospects, usage] = await Promise.all([
    db.from("insurance_prospects").select("*").order("updated_at", { ascending: false }).limit(500),
    db.from("insurance_api_usage").select("provider,used").eq("month", new Date().toISOString().slice(0, 7)),
  ]);
  if (prospects.error || usage.error) return NextResponse.json({ error: "Insurance workspace could not be loaded" }, { status: 503 });
  return NextResponse.json({ prospects: prospects.data, usage: usage.data, monthlyCap: INSURANCE_MONTHLY_CAP,
    configured: { search: Boolean(process.env.SERPAPI_API_KEY), fallback: Boolean(process.env.PRODUCERFORGE_OLLAMA_API_KEY), drafts: Boolean(process.env.PRODUCERFORGE_GEMINI_API_KEY || process.env.PRODUCERFORGE_GEMINI_API_KEY_2) } });
}
async function save(req: NextRequest, creating: boolean) {
  try {
    const raw = await req.text();
    if (raw.length > 18000) throw new InsuranceInputError("Prospect record is too large");
    const body = JSON.parse(raw);
    const record = prospectInput(body, creating);
    const db = insuranceDb();
    const source_key = createHash("sha256").update(record.source.url).digest("hex");
    if (creating) {
      // A duplicate save never overwrites existing notes, contacts, or stages.
      const { error } = await db.from("insurance_prospects").upsert({ ...record, source_key }, { onConflict: "track,state,source_key", ignoreDuplicates: true });
      if (error) throw new Error("Could not save this insurance prospect");
      const { data, error: readError } = await db.from("insurance_prospects").select("*").eq("track", record.track).eq("state", record.state).eq("source_key", source_key).single();
      if (readError) throw new Error("Saved record could not be reloaded");
      return NextResponse.json({ prospect: data });
    }
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new InsuranceInputError("Invalid prospect ID");
    if (typeof body.updated_at !== "string") throw new InsuranceInputError("Reload the record before saving");
    const { data, error } = await db.from("insurance_prospects").update({ ...record, source_key, updated_at: new Date().toISOString() })
      .eq("id", body.id).eq("updated_at", body.updated_at).select("*").maybeSingle();
    if (error) throw new Error("Could not update this insurance prospect");
    if (!data) return NextResponse.json({ error: "This record changed in another window. Reload before saving." }, { status: 409 });
    return NextResponse.json({ prospect: data });
  } catch (error) {
    const invalid = error instanceof InsuranceInputError || error instanceof SyntaxError || error instanceof TypeError;
    return NextResponse.json({ error: invalid ? (error instanceof InsuranceInputError ? error.message : "Invalid prospect record") : error instanceof Error ? error.message : "Save failed" }, { status: invalid ? 400 : 503 });
  }
}
export const POST = (req: NextRequest) => save(req, true);
export const PATCH = (req: NextRequest) => save(req, false);
