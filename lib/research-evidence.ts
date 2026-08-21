export type ResearchCertainty = "verified" | "single_source" | "ai_inference" | "not_found";

import { hvacGaps, HvacSignals } from "@/lib/hvac-signals";

export interface ResearchFact {
  field_name: string;
  label: string;
  value: string | null;
  certainty: ResearchCertainty;
  source_label: string | null;
  source_url: string | null;
  source_count: number;
  researched_at: string;
}

interface EvidenceLead {
  business_name?: string | null;
  owner_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  industry?: string | null;
  niche?: string | null;
  short_description?: string | null;
  technologies?: string | null;
  current_software?: string | null;
  monthly_spend_estimate?: string | null;
  google_rating?: string | number | null;
  google_review_count?: string | number | null;
  employees?: string | null;
  employee_count?: string | number | null;
  annual_revenue?: string | null;
  founded_year?: string | null;
  source?: string | null;
}

interface ScrapedEvidence {
  hvac_signals?: HvacSignals;
  hvac_gaps?: string[];
  owner?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
  technologies?: string | null;
  current_software?: string | null;
  google_business_url?: string | null;
  google_profile?: string | null;
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned : null;
};

export function cleanResearchAddress(lead: EvidenceLead): string | null {
  const parts = [lead.address, lead.city, lead.state, lead.postal_code]
    .flatMap((value) => text(value)?.split(",") || [])
    .map((value) => value.trim())
    .filter((value): value is string => Boolean(value));
  const kept: string[] = [];
  for (const part of parts) {
    const normalized = part.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalized) continue;
    const duplicate = kept.some((existing) => {
      const known = existing.toLowerCase().replace(/[^a-z0-9]/g, "");
      return known === normalized;
    });
    if (!duplicate) kept.push(part);
  }
  return kept.length ? kept.join(", ") : null;
}

function comparable(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildResearchFacts(lead: EvidenceLead, scraped: ScrapedEvidence = {}): ResearchFact[] {
  const researched_at = new Date().toISOString();
  const website = text(lead.website);
  const googleUrl = text(scraped.google_business_url || scraped.google_profile);
  const discoveryLabel = lead.source === "google_places" ? "Google Places discovery" : "Discovery record";
  const fact = (
    field_name: string,
    label: string,
    value: unknown,
    certainty: ResearchCertainty,
    source_label: string | null,
    source_url: string | null,
    source_count = value ? 1 : 0
  ): ResearchFact => ({ field_name, label, value: text(value), certainty: text(value) ? certainty : "not_found", source_label: text(value) ? source_label : null, source_url: text(value) ? source_url : null, source_count: text(value) ? source_count : 0, researched_at });

  const storedAddress = cleanResearchAddress(lead);
  const scrapedAddress = text(scraped.address);
  const addressMatches = Boolean(storedAddress && scrapedAddress && (
    comparable(storedAddress).includes(comparable(scrapedAddress)) ||
    comparable(scrapedAddress).includes(comparable(storedAddress))
  ));

  const sig = scraped.hvac_signals as HvacSignals | undefined;
  const gaps: string[] = Array.isArray(scraped.hvac_gaps) ? scraped.hvac_gaps : sig ? hvacGaps(sig) : [];
  const yn = (v?: boolean) => (v === undefined ? null : v ? "Yes" : "No");
  const list = (v?: string[]) => (v && v.length ? v.join(", ") : null);

  return [
    fact("owner", "Owner or decision maker", scraped.owner || lead.owner_name || lead.contact_name, "single_source", scraped.owner ? "Company website" : discoveryLabel, scraped.owner ? website : null),
    fact("industry", "Industry", lead.industry || lead.niche, "single_source", discoveryLabel, googleUrl),
    fact("address", "Business address", scrapedAddress || storedAddress, addressMatches ? "verified" : "single_source", addressMatches ? "Company website and discovery record" : scrapedAddress ? "Company website" : discoveryLabel, addressMatches ? website : scrapedAddress ? website : googleUrl, addressMatches ? 2 : 1),
    fact("phone", "Phone", scraped.phone || lead.phone, "single_source", scraped.phone ? "Company website" : discoveryLabel, scraped.phone ? website : googleUrl),
    fact("email", "Email", scraped.email || lead.email, "single_source", scraped.email ? "Company website" : discoveryLabel, scraped.email ? website : null),
    fact("current_software", "Operating software", scraped.current_software || lead.current_software, "single_source", scraped.current_software ? "Company website booking signal" : discoveryLabel, scraped.current_software ? website : null),
    fact("website_technologies", "Website technology", scraped.technologies || lead.technologies, "single_source", "Company website code", website),
    fact("monthly_spend", "Estimated monthly spend", lead.monthly_spend_estimate, "ai_inference", "CRM estimate", null),
    fact("google_rating", "Google rating", lead.google_rating, "single_source", "Google Places", googleUrl),
    fact("google_reviews", "Google reviews", lead.google_review_count, "single_source", "Google Places", googleUrl),
    fact("company_profile", "Company profile", scraped.description || lead.short_description, "single_source", scraped.description ? "Company website" : discoveryLabel, scraped.description ? website : googleUrl),
    fact("company_size", "Company size", lead.employee_count || lead.employees, "single_source", discoveryLabel, null),
    fact("founded_year", "Year founded", lead.founded_year, "single_source", discoveryLabel, null),
    fact("annual_revenue", "Annual revenue", lead.annual_revenue, "single_source", discoveryLabel, null),

    // ── HVAC-specific intelligence: what to actually sell them ──────────────
    // Every one of these is read off their own site, so it is citable in
    // outreach rather than inferred.
    fact("hvac_booking", "Online booking", yn(sig?.online_booking), sig?.online_booking ? "verified" : "single_source", sig?.online_booking ? "Company website" : "Not found on pages read", website),
    fact("hvac_emergency", "24/7 emergency service", yn(sig?.emergency_24_7), sig?.emergency_24_7 ? "verified" : "single_source", sig?.emergency_24_7 ? "Company website" : "Not found on pages read", website),
    fact("hvac_financing", "Financing offered", yn(sig?.financing), sig?.financing ? "verified" : "single_source", sig?.financing ? "Company website" : "Not found on pages read", website),
    fact("hvac_maintenance", "Maintenance plan", yn(sig?.maintenance_plan), sig?.maintenance_plan ? "verified" : "single_source", sig?.maintenance_plan ? "Company website" : "Not found on pages read", website),
    fact("hvac_brands", "Brands carried", list(sig?.brands), "verified", "Company website", website),
    fact("hvac_certifications", "Certifications", list(sig?.certifications), "verified", "Company website", website),
    fact("hvac_services", "Services offered", list(sig?.services), "verified", "Company website", website),
    fact("hvac_segments", "Market served", list(sig?.segments), "verified", "Company website", website),
    fact("hvac_license", "Contractor license", list(sig?.license_numbers), "verified", "Company website", website),
    fact("hvac_mobile", "Mobile friendly site", yn(sig?.mobile_friendly), sig?.mobile_friendly ? "verified" : "single_source", sig?.mobile_friendly ? "Company website code" : "Not found on pages read", website),
    fact("hvac_tracking", "Ad / analytics tracking", yn(sig?.runs_ads_or_tracking), sig?.runs_ads_or_tracking ? "verified" : "single_source", sig?.runs_ads_or_tracking ? "Company website code" : "Not found on pages read", website),
    fact("hvac_chat", "Chat / instant capture", yn(sig?.chat_widget), sig?.chat_widget ? "verified" : "single_source", sig?.chat_widget ? "Company website code" : "Not found on pages read", website),
    fact("hvac_reviews_widget", "Reviews shown on site", yn(sig?.review_widget), sig?.review_widget ? "verified" : "single_source", sig?.review_widget ? "Company website code" : "Not found on pages read", website),
    fact("hvac_gaps", "Sellable gaps", gaps.length ? gaps.join(" | ") : null, "verified", "Company website", website, gaps.length),
  ];
}
