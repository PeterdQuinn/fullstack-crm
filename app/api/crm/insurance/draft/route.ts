import { NextRequest, NextResponse } from "next/server";
import { insuranceDb, reserveInsuranceRequest } from "@/lib/insurance/db";
import { insuranceDraft, refineInsuranceDraft } from "@/lib/insurance/draft";
export const maxDuration = 45;
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > 2000) return NextResponse.json({ error: "Draft request is too large" }, { status: 400 });
    const body = JSON.parse(raw);
    if (!body || typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || (body.context != null && (typeof body.context !== "string" || body.context.length > 500))) return NextResponse.json({ error: "Invalid draft request" }, { status: 400 });
    const { data, error } = await insuranceDb().from("insurance_prospects").select("*").eq("id", body.id).single();
    if (error) return NextResponse.json({ error: "Could not load the saved prospect" }, { status: 404 });
    if (data.stage === "Do not contact") return NextResponse.json({ error: "This record is marked Do not contact" }, { status: 409 });
    const base = insuranceDraft(data);
    if (body.refine !== true) return NextResponse.json(base);
    const result = await refineInsuranceDraft(base, body.context || "Keep it brief and conversational", {
      keys: [process.env.PRODUCERFORGE_GEMINI_API_KEY || "", process.env.PRODUCERFORGE_GEMINI_API_KEY_2 || ""],
      reserve: () => reserveInsuranceRequest("gemini"),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Draft could not be prepared. The saved prospect has not changed." }, { status: 503 });
  }
}
