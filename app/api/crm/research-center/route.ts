import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateLeadSummary } from "@/lib/grok";
import { logStatusChange } from "@/lib/audit";
import { looksLikeRealEmail } from "@/lib/email-validation";
import { buildResearchFacts } from "@/lib/research-evidence";
import { researchInternetPresence, type InternetObservation } from "@/lib/internet-intelligence";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESEARCH_STATUSES = ["New", "Needs Data", "Ready for AI Summary", "Scored"];
const JUNK_EMAIL = /duckduckgo|example\.(com|org|net)|error|noreply|no-reply|@sentry\./i;

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select(`
        id, business_name, owner_name, contact_name, phone, email, website,
        address, city, state, postal_code, niche, industry, status,
        short_description, technologies, current_software, source,
        employees, employee_count, annual_revenue, founded_year,
        monthly_spend_estimate, google_rating, google_review_count,
        created_at, updated_at,
        lead_ai_summaries(lead_score, confidence_level, main_pain_point,
          pain_reason, best_attack_angle, recommended_first_message,
          recommended_follow_up, missing_data_needed, updated_at),
        lead_socials(platform, url, username, is_active)
      `)
      .in("status", RESEARCH_STATUSES)
      .is("archived_at", null)
      .eq("opt_out", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const leadIds = (data || []).map((lead: any) => lead.id);
    const { data: storedFacts, error: factsError } = leadIds.length
      ? await supabase.from("lead_research_facts").select("lead_id, field_name, label, field_value, certainty, source_label, source_url, source_count, researched_at").in("lead_id", leadIds)
      : { data: [], error: null };
    const factsByLead = new Map<string, any[]>();
    for (const row of storedFacts || []) {
      const list = factsByLead.get(row.lead_id) || [];
      list.push({ ...row, value: row.field_value });
      factsByLead.set(row.lead_id, list);
    }
    const { data: intelligenceRows, error: intelligenceError } = leadIds.length
      ? await supabase.from("lead_internet_intelligence").select("*").in("lead_id", leadIds)
      : { data: [], error: null };
    const { data: observationRows } = leadIds.length && !intelligenceError
      ? await supabase.from("lead_internet_observations").select("*").in("lead_id", leadIds).order("observed_at", { ascending: false }).limit(1000)
      : { data: [] };
    const intelligenceByLead = new Map((intelligenceRows || []).map((row: any) => [row.lead_id, row]));
    const observationsByLead = new Map<string, any[]>();
    for (const row of observationRows || []) {
      const list = observationsByLead.get(row.lead_id) || [];
      if (list.length < 30) list.push(row);
      observationsByLead.set(row.lead_id, list);
    }

    return NextResponse.json((data || []).map((lead: any) => {
      const researchFacts = factsByLead.get(lead.id) || buildResearchFacts(lead);
      const intelligence = intelligenceByLead.get(lead.id) as any;
      if (intelligence) researchFacts.unshift(
        { field_name: "internet_footprint", label: "Internet footprint", value: `${intelligence.footprint_score}/100`, certainty: "ai_inference", source_label: "Dated internet observations", source_url: null, source_count: (observationsByLead.get(lead.id) || []).length, researched_at: intelligence.researched_at },
        { field_name: "growth_momentum", label: "Growth momentum", value: `${intelligence.momentum_score > 0 ? "+" : ""}${intelligence.momentum_score} — ${intelligence.momentum_label}. ${intelligence.summary}`, certainty: "ai_inference", source_label: "Deterministic signal score", source_url: null, source_count: (observationsByLead.get(lead.id) || []).filter((item: any) => item.growth_direction !== 0).length, researched_at: intelligence.researched_at },
      );
      const sourceCandidates = [
        lead.website ? { label: "Company website", url: lead.website } : null,
        ...(lead.lead_socials || []).filter((item: any) => item.is_active && item.url).map((item: any) => ({ label: item.platform, url: item.url })),
        ...researchFacts.filter((fact: any) => fact.source_url).map((fact: any) => ({ label: fact.source_label || fact.label, url: fact.source_url })),
        ...(observationsByLead.get(lead.id) || []).map((item: any) => ({ label: `${item.category}: ${item.signal}`, url: item.source_url })),
      ].filter(Boolean) as Array<{ label: string; url: string }>;
      const sources = [...new Map(sourceCandidates.map((source) => [source.url, source])).values()];
      return {
        ...lead,
        ai_summary: Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] || null : lead.lead_ai_summaries,
        research_facts: researchFacts,
        evidence_storage_ready: !factsError,
        internet_intelligence: intelligence || null,
        internet_observations: observationsByLead.get(lead.id) || [],
        internet_storage_ready: !intelligenceError,
        sources,
      };
    }));
  } catch (error) {
    console.error("Research Center load error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load research leads" }, { status: 500 });
  }
}

async function selectedResearch(lead: any) {
  let scraped: any = {};
  if (lead.website) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const response = await fetch(`${base}/api/scrape-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website: lead.website, business_name: lead.business_name, city: lead.city || "", fast: true }),
    });
    if (response.ok) scraped = await response.json();
  }

  const updates: Record<string, unknown> = {};
  if (scraped.email && !lead.email && !JUNK_EMAIL.test(scraped.email) && looksLikeRealEmail(scraped.email)) updates.email = scraped.email;
  if (scraped.phone && !lead.phone) updates.phone = scraped.phone;
  if (scraped.owner && !lead.owner_name) updates.owner_name = scraped.owner;
  if (scraped.current_software && !lead.current_software) updates.current_software = scraped.current_software;
  if (scraped.description && !lead.short_description) updates.short_description = scraped.description;
  if (scraped.address && !lead.address) updates.address = scraped.address;
  if (scraped.technologies && !lead.technologies) updates.technologies = scraped.technologies;

  // Signals ride along so the summary prompt can cite the contractor's own site.
  const enriched = { ...lead, ...updates, hvac_signals: scraped.hvac_signals };
  const researchFacts = buildResearchFacts(enriched, scraped);
  const { data: previousRows } = await supabase.from("lead_internet_observations").select("*").eq("lead_id", lead.id).order("observed_at", { ascending: false }).limit(200);
  const previous: InternetObservation[] = (previousRows || []).map((row: any) => ({ category: row.category, signal: row.signal, value: row.value, numericValue: row.numeric_value == null ? undefined : Number(row.numeric_value), sourceLabel: row.source_label, sourceUrl: row.source_url, confidence: row.confidence, growthDirection: row.growth_direction, observedAt: row.observed_at }));
  const internet = await researchInternetPresence(enriched, previous);
  const summary = await generateLeadSummary(enriched);
  const { error: summaryError } = await supabase.from("lead_ai_summaries").upsert({
    lead_id: lead.id,
    main_pain_point: summary.main_pain_point,
    pain_reason: summary.pain_reason,
    best_attack_angle: summary.best_attack_angle,
    recommended_first_message: summary.recommended_first_message,
    recommended_follow_up: summary.recommended_follow_up,
    lead_score: summary.lead_score,
    confidence_level: summary.confidence_level,
    missing_data_needed: summary.missing_data_needed,
  }, { onConflict: "lead_id" });
  if (summaryError) throw new Error(summaryError.message);

  const { error: leadError } = await supabase.from("leads").update({ ...updates, status: "Scored", updated_at: new Date().toISOString() }).eq("id", lead.id);
  if (leadError) throw new Error(leadError.message);

  const { error: factsError } = await supabase.from("lead_research_facts").upsert(
    researchFacts.map((fact) => ({
      lead_id: lead.id,
      field_name: fact.field_name,
      label: fact.label,
      field_value: fact.value,
      certainty: fact.certainty,
      source_label: fact.source_label,
      source_url: fact.source_url,
      source_count: fact.source_count,
      researched_at: fact.researched_at,
    })),
    { onConflict: "lead_id,field_name" }
  );
  const evidenceWarning = factsError
    ? `Research saved, but its evidence was not stored. Apply migration 010 to enable evidence storage. (${factsError.message})`
    : null;
  const { error: observationError } = internet.observations.length ? await supabase.from("lead_internet_observations").insert(internet.observations.map((item) => ({ lead_id: lead.id, category: item.category, signal: item.signal, value: item.value, numeric_value: item.numericValue ?? null, source_label: item.sourceLabel, source_url: item.sourceUrl, confidence: item.confidence, growth_direction: item.growthDirection, observed_at: item.observedAt }))) : { error: null };
  const { error: intelligenceError } = await supabase.from("lead_internet_intelligence").upsert({ lead_id: lead.id, footprint_score: internet.footprintScore, momentum_score: internet.momentumScore, momentum_label: internet.momentumLabel, summary: internet.summary, provider: internet.provider, credits_used: internet.creditsUsed, researched_at: new Date().toISOString() });
  const internetWarning = observationError || intelligenceError ? `Internet intelligence was calculated but not stored. Apply migration 014. (${observationError?.message || intelligenceError?.message})` : internet.warning || null;

  const socialCandidates = [
    ["facebook", scraped.facebook_url], ["instagram", scraped.instagram_url],
    ["linkedin", scraped.linkedin_url], ["twitter", scraped.twitter_url],
    ["google_business", scraped.google_business_url || scraped.google_profile],
  ].filter((entry) => entry[1]);
  for (const [platform, url] of socialCandidates) {
    const { data: existing } = await supabase.from("lead_socials").select("id").eq("lead_id", lead.id).eq("platform", platform).maybeSingle();
    if (!existing) await supabase.from("lead_socials").insert({ lead_id: lead.id, platform, url, is_active: true });
  }
  await logStatusChange({ leadId: lead.id, from: lead.status, to: "Scored", source: "owner", reason: "Manual AI research completed" });
  return { summary, evidenceWarning: [evidenceWarning, internetWarning].filter(Boolean).join(" ") || null };
}

export async function POST(req: NextRequest) {
  try {
    const { leadId, action, researchReviewed } = await req.json();
    if (!leadId || !action) return NextResponse.json({ error: "Lead and action are required" }, { status: 400 });

    const { data: lead, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
    if (error || !lead) return NextResponse.json({ error: "Lead was not found" }, { status: 404 });

    if ((lead.opt_out || lead.status === "Do Not Contact" || lead.bounced || lead.complained) && action !== "do_not_contact") {
      return NextResponse.json({ error: "This lead is suppressed and cannot enter an outreach workflow" }, { status: 409 });
    }

    if (action === "research") {
      const { summary, evidenceWarning } = await selectedResearch(lead);
      return NextResponse.json({ success: true, summary, warning: evidenceWarning });
    }

    let updates: Record<string, unknown>;
    let reason: string;
    if (action === "approve_email") {
      const { data: score } = await supabase.from("lead_ai_summaries").select("lead_score, confidence_level").eq("lead_id", leadId).maybeSingle();
      const market = String(lead.industry || lead.niche || "").toLowerCase();
      if (!lead.email) return NextResponse.json({ error: "An email address is required before approval" }, { status: 409 });
      if (market !== "hvac") return NextResponse.json({ error: "Only HVAC leads can enter this email workflow" }, { status: 409 });
      if (!score || score.lead_score <= 50) return NextResponse.json({ error: "A reviewed score above 50 is required" }, { status: 409 });
      if (score.confidence_level === "low" && researchReviewed !== true) return NextResponse.json({ error: "Low confidence research must be checked against its sources before approval" }, { status: 409 });
      updates = { status: "Ready for Outreach" }; reason = "Approved for Email Workspace";
    } else if (action === "move_calls") {
      if (!lead.phone) return NextResponse.json({ error: "A phone number is required before moving to Calls" }, { status: 409 });
      updates = { status: "Call Needed" }; reason = "Approved for Call Workspace";
    } else if (action === "needs_more") {
      updates = { status: "Needs Data" }; reason = "More research requested";
    } else if (action === "reject") {
      updates = { status: "Dead" }; reason = "Lead rejected during research";
    } else if (action === "do_not_contact") {
      updates = { status: "Do Not Contact", opt_out: true, status_before_suppression: lead.status }; reason = "Suppressed during research";
    } else {
      return NextResponse.json({ error: "Unknown research action" }, { status: 400 });
    }

    const nextStatus = String(updates.status);
    const { error: updateError } = await supabase.from("leads").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
    await logStatusChange({ leadId, from: lead.status, to: nextStatus, source: "owner", reason });
    if (action === "do_not_contact") {
      await supabase.from("follow_up_tasks").update({ status: "cancelled", completed_at: new Date().toISOString(), notes: "Cancelled because contact was suppressed" }).eq("lead_id", leadId).eq("status", "pending");
    }
    return NextResponse.json({ success: true, status: nextStatus });
  } catch (error) {
    console.error("Research Center action error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Research action failed" }, { status: 500 });
  }
}
