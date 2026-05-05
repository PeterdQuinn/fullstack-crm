import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function scrapeLeadData(lead: any) {
  try {
    const body = {
      website: lead.website || undefined,
      business_name: lead.business_name,
      city: lead.city || "",
    };

    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return await res.json();
  } catch (error) {
    console.error(`Scrape failed for ${lead.business_name}:`, error);
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .neq("email", null)
      .neq("email", "")
      .limit(100);

    if (error || !leads) {
      return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }

    console.log(`🔍 Researching ${leads.length} leads...`);

    const results = { updated: 0, found: 0, errors: 0 };

    for (const lead of leads) {
      try {
        // Only scrape if missing critical data
        if (!lead.phone || !lead.owner_name || !lead.short_description) {
          const scrapedData = await scrapeLeadData(lead);

          const updates: any = {};
          if (scrapedData.phone && !lead.phone) updates.phone = scrapedData.phone;
          if (scrapedData.owner && !lead.owner_name) updates.owner_name = scrapedData.owner;
          if (scrapedData.email && !lead.email) updates.email = scrapedData.email;
          if (scrapedData.current_software && !lead.current_software)
            updates.current_software = scrapedData.current_software;
          if (scrapedData.description && !lead.short_description)
            updates.short_description = scrapedData.description;
          if (scrapedData.address && !lead.address) updates.address = scrapedData.address;
          if (scrapedData.technologies && !lead.technologies) updates.technologies = scrapedData.technologies;
          if (scrapedData.yelp_url && !lead.yelp_url) updates.yelp_url = scrapedData.yelp_url;
          if (scrapedData.bbb_url) updates.bbb_url = scrapedData.bbb_url;

          if (Object.keys(updates).length > 0) {
            await supabase.from("leads").update(updates).eq("id", lead.id);
            results.updated++;
            results.found += Object.keys(updates).length;
            console.log(`✓ Updated ${lead.business_name} with ${Object.keys(updates).length} fields`);
          }

          // Save social links to lead_socials table
          const socials = [
            { platform: "linkedin", url: scrapedData.linkedin_url },
            { platform: "linkedin_company", url: scrapedData.linkedin_company_url },
            { platform: "facebook", url: scrapedData.facebook_url },
            { platform: "instagram", url: scrapedData.instagram_url },
            { platform: "twitter", url: scrapedData.twitter_url },
            { platform: "yelp", url: scrapedData.yelp_url },
            { platform: "bbb", url: scrapedData.bbb_url },
          ].filter(s => s.url);

          for (const social of socials) {
            try {
              await supabase.from("lead_socials").upsert({
                lead_id: lead.id,
                platform: social.platform,
                url: social.url,
                is_active: true,
              });
            } catch (err) {
              // Ignore conflicts
            }
          }

          if (socials.length > 0) {
            results.found += socials.length;
            console.log(`✓ Added ${socials.length} social profiles for ${lead.business_name}`);
          }
        }

        // Rate limit
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error scraping ${lead.business_name}:`, error);
        results.errors++;
      }
    }

    return NextResponse.json({
      success: true,
      updated: results.updated,
      fieldsFound: results.found,
      errors: results.errors,
      message: `✅ Researched ${leads.length} leads. Updated ${results.updated} with ${results.found} new data points.`,
    });
  } catch (error) {
    console.error("Bulk research error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Research failed" },
      { status: 500 }
    );
  }
}
