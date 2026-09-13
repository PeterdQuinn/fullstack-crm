import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { insuranceDb, reserveInsuranceRequest } from "@/lib/insurance/db";
import { searchInsurance } from "@/lib/insurance/search";
import { searchInput, InsuranceInputError } from "@/lib/insurance/validation";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const raw = await req.text();
    if (raw.length > 2000) throw new InsuranceInputError("Search request is too large");
    const options = searchInput(JSON.parse(raw));
    const key = createHash("sha256").update(JSON.stringify(options)).digest("hex");
    const db = insuranceDb();
    const { data, error } = await db.from("insurance_search_cache").select("result").eq("key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw new Error("Insurance search storage is unavailable");
    if (data) return NextResponse.json({ ...data.result, cached: true, elapsedMs: Date.now() - started });
    const result = await searchInsurance(options, { reserve: reserveInsuranceRequest,
      serpKey: process.env.SERPAPI_API_KEY, ollamaKey: process.env.PRODUCERFORGE_OLLAMA_API_KEY });
    const { error: cacheError } = await db.from("insurance_search_cache").upsert({ key, result, expires_at: new Date(Date.now() + 3600000).toISOString() });
    return NextResponse.json({ ...result, cached: false, elapsedMs: Date.now() - started,
      ...(cacheError ? { warning: [result.warning, "Results could not be cached"].filter(Boolean).join("; ") } : {}) });
  } catch (error) {
    const badInput = error instanceof InsuranceInputError || error instanceof SyntaxError || error instanceof TypeError;
    return NextResponse.json({ error: badInput ? (error instanceof InsuranceInputError ? error.message : "Invalid search request") : error instanceof Error ? error.message : "Search failed" }, { status: badInput ? 400 : 503 });
  }
}
