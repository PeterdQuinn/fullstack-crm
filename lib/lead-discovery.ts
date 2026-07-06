import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface DiscoveredLead {
  business_name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  owner_name?: string;
  industry?: string;
  niche?: string;
  short_description?: string;
  rating?: number;
  review_count?: number;
}

// Deduplicate leads by business_name + city + phone
export function deduplicateLeads(leads: DiscoveredLead[]): DiscoveredLead[] {
  const seen = new Set<string>();
  const deduplicated: DiscoveredLead[] = [];

  for (const lead of leads) {
    const key = `${lead.business_name}|${lead.city}|${lead.phone || ""}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(lead);
    }
  }

  return deduplicated;
}

// Check if lead already exists in database (by email or business_name + city)
export async function checkLeadExists(lead: DiscoveredLead): Promise<boolean> {
  if (lead.email) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("email", lead.email)
      .single();
    if (data) return true;
  }

  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("business_name", lead.business_name)
    .eq("city", lead.city || "")
    .single();

  return !!data;
}

// Filter out existing leads
export async function filterNewLeads(leads: DiscoveredLead[]): Promise<DiscoveredLead[]> {
  const newLeads: DiscoveredLead[] = [];

  for (const lead of leads) {
    const exists = await checkLeadExists(lead);
    if (!exists) {
      newLeads.push(lead);
    }
  }

  return newLeads;
}

// Normalize lead data (trim, clean phone, etc)
export function normalizeLead(lead: DiscoveredLead): DiscoveredLead {
  return {
    business_name: lead.business_name?.trim() || "",
    phone: lead.phone?.replace(/\D/g, "").slice(-10) || undefined,
    email: lead.email?.toLowerCase().trim() || undefined,
    website: lead.website?.trim() || undefined,
    address: lead.address?.trim() || undefined,
    city: lead.city?.trim() || undefined,
    state: lead.state?.trim()?.toUpperCase() || undefined,
    owner_name: lead.owner_name?.trim() || undefined,
    industry: lead.industry?.trim() || undefined,
    niche: lead.niche?.trim() || undefined,
    short_description: lead.short_description?.trim() || undefined,
    rating: lead.rating,
    review_count: lead.review_count,
  };
}

// Enrich lead with email by scraping website
export async function enrichLeadEmail(lead: DiscoveredLead): Promise<DiscoveredLead> {
  if (lead.email) return lead;
  if (!lead.website) return lead;

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        website: lead.website,
        business_name: lead.business_name,
        city: lead.city || "",
      }),
    });

    const scrapedData = await res.json();
    if (scrapedData.email) {
      lead.email = scrapedData.email;
    }
    if (scrapedData.phone && !lead.phone) {
      lead.phone = scrapedData.phone;
    }
    if (scrapedData.owner && !lead.owner_name) {
      lead.owner_name = scrapedData.owner;
    }
  } catch (error) {
    console.error(`Email enrichment failed for ${lead.business_name}:`, error);
  }

  return lead;
}

// Batch enrich leads with emails
export async function enrichLeadsEmails(leads: DiscoveredLead[], maxConcurrent = 3): Promise<DiscoveredLead[]> {
  const enriched: DiscoveredLead[] = [];
  const queue = [...leads];

  while (queue.length > 0) {
    const batch = queue.splice(0, maxConcurrent);
    const batchResults = await Promise.all(batch.map(enrichLeadEmail));
    enriched.push(...batchResults);

    // Rate limit
    if (queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return enriched;
}

// Import leads directly (in-process). Runs inside the discovery pipeline, which
// lives under /api/admin behind Basic Auth, so a self-HTTP call to the
// bulk-import route would 401 — we insert with the service-role client instead.
// Accepts any real lead with a name and at least one of phone/website/email
// (Places/Overpass give phone+website; email is enriched or captured later).
export async function importLeads(leads: DiscoveredLead[]): Promise<{
  imported: number;
  skipped: number;
  errors: number;
  importedIds: string[];
}> {
  const result = { imported: 0, skipped: 0, errors: 0, importedIds: [] as string[] };

  for (const lead of leads) {
    try {
      if (!lead.business_name || !(lead.phone || lead.website || lead.email)) {
        result.skipped++;
        continue;
      }

      // Dedupe against existing rows: by email if present, else name + city.
      let exists = false;
      if (lead.email) {
        const { data } = await supabase.from("leads").select("id").eq("email", lead.email).maybeSingle();
        exists = !!data;
      }
      if (!exists) {
        const { data } = await supabase
          .from("leads")
          .select("id")
          .eq("business_name", lead.business_name)
          .eq("city", lead.city || "")
          .maybeSingle();
        exists = !!data;
      }
      if (exists) {
        result.skipped++;
        continue;
      }

      const { data: inserted, error } = await supabase
        .from("leads")
        .insert({
          business_name: lead.business_name,
          email: lead.email || null,
          phone: lead.phone || null,
          website: lead.website || null,
          address: lead.address || null,
          city: lead.city || null,
          state: lead.state || null,
          niche: lead.niche || "General",
          industry: lead.industry || lead.niche || null,
          short_description: lead.short_description || null,
          status: "New",
          opt_out: false,
          bounced: false,
          complained: false,
          email_sent_count: 0,
        })
        .select("id");

      if (error) {
        console.error(`Error importing ${lead.business_name}:`, error.message);
        result.errors++;
      } else {
        result.imported++;
        if (inserted?.[0]?.id) result.importedIds.push(inserted[0].id);
      }
    } catch (error) {
      console.error(`Exception importing ${lead.business_name}:`, error);
      result.errors++;
    }
  }

  return result;
}
