import { createClient } from "@supabase/supabase-js";

// Shared lead-enrichment batch logic, callable in-process from the admin route
// (manual) or the cron route (automated). Scrapes each lead's website via the
// public /api/scrape-phone endpoint for email + socials + owner/software, and
// saves them. Small batches only — each scrape is a headless-browser call.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Reject scraper junk emails (e.g. the DuckDuckGo fallback grabbing
// duckduckgo.com's own address) so they never enter the leads table.
const JUNK_EMAIL = /duckduckgo|example\.(com|org|net)|error|noreply|no-reply|@sentry\./i;

async function scrapeLeadData(lead: any) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: lead.website || undefined,
          business_name: lead.business_name,
          city: lead.city || "",
        }),
      }
    );
    return await res.json();
  } catch (error) {
    console.error(`Scrape failed for ${lead.business_name}:`, error);
    return {};
  }
}

export type EnrichResult = {
  processed: number;
  updated: number;
  emailsFound: number;
  socialsFound: number;
  errors: number;
  error?: string;
};

export async function enrichLeadsBatch(batchSize = 3): Promise<EnrichResult> {
  // Leads with a website to scrape but no email yet — those unblock the email
  // queue. Ordered oldest-touched-first, and every processed lead's updated_at
  // is bumped, so repeated cron runs rotate through the whole backlog instead
  // of retrying the same few.
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, business_name, website, city, email, phone, owner_name, short_description, current_software, technologies, address")
    .not("website", "is", null)
    .neq("website", "")
    .or("email.is.null,email.eq.")
    .order("updated_at", { ascending: true })
    .limit(Math.min(batchSize, 8));

  if (error || !leads) {
    return { processed: 0, updated: 0, emailsFound: 0, socialsFound: 0, errors: 0, error: error?.message };
  }

  const result: EnrichResult = { processed: leads.length, updated: 0, emailsFound: 0, socialsFound: 0, errors: 0 };

  for (const lead of leads) {
    try {
      const s = await scrapeLeadData(lead);

      const updates: any = {};
      if (s.email && !lead.email && !JUNK_EMAIL.test(s.email)) { updates.email = s.email; result.emailsFound++; }
      if (s.phone && !lead.phone) updates.phone = s.phone;
      if (s.owner && !lead.owner_name) updates.owner_name = s.owner;
      if (s.current_software && !lead.current_software) updates.current_software = s.current_software;
      if (s.description && !lead.short_description) updates.short_description = s.description;
      if (s.address && !lead.address) updates.address = s.address;
      if (s.technologies && !lead.technologies) updates.technologies = s.technologies;

      if (Object.keys(updates).length > 0) result.updated++;
      // Always bump updated_at so this lead rotates to the back of the queue,
      // even when nothing new was found (otherwise the cron re-scrapes it forever).
      updates.updated_at = new Date().toISOString();
      await supabase.from("leads").update(updates).eq("id", lead.id);

      const socials = [
        { platform: "facebook", url: s.facebook_url },
        { platform: "instagram", url: s.instagram_url },
        { platform: "linkedin", url: s.linkedin_url },
        { platform: "linkedin_company", url: s.linkedin_company_url },
        { platform: "twitter", url: s.twitter_url },
        { platform: "google_business", url: s.google_business_url },
      ].filter((x) => x.url);

      for (const soc of socials) {
        // Only add a social row if this lead doesn't already have that platform,
        // so repeated runs don't create duplicates.
        const { data: existing } = await supabase
          .from("lead_socials")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("platform", soc.platform)
          .maybeSingle();
        if (!existing) {
          await supabase.from("lead_socials").insert({ lead_id: lead.id, platform: soc.platform, url: soc.url, is_active: true });
          result.socialsFound++;
        }
      }
    } catch (error) {
      console.error(`Enrich error for ${lead.business_name}:`, error);
      result.errors++;
    }
  }

  return result;
}
