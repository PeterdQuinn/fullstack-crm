import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const leads = body.leads || [];

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: "Provide array of leads with business_name and email" },
        { status: 400 }
      );
    }

    console.log(`📥 Importing ${leads.length} leads...`);

    const results = { imported: 0, errors: 0, skipped: 0 };
    const imported = [];

    for (const lead of leads) {
      try {
        if (!lead.business_name || !lead.email) {
          results.skipped++;
          continue;
        }

        // Check if lead already exists by email
        const { data: existing } = await supabase
          .from("leads")
          .select("id")
          .eq("email", lead.email)
          .single();

        if (existing) {
          results.skipped++;
          continue;
        }

        // Insert or update lead
        const { data: insertedLead, error } = await supabase
          .from("leads")
          .insert({
            business_name: lead.business_name,
            email: lead.email,
            phone: lead.phone || null,
            owner_name: lead.owner_name || null,
            website: lead.website || null,
            short_description: lead.short_description || null,
            industry: lead.industry || null,
            current_software: lead.current_software || null,
            monthly_spend_estimate: lead.monthly_spend_estimate || null,
            technologies: lead.technologies || null,
            status: "New",
            opt_out: false,
            bounced: false,
            complained: false,
            email_sent_count: 0,
          })
          .select();

        if (error) {
          console.error(`Error importing ${lead.business_name}:`, error);
          results.errors++;
        } else {
          results.imported++;
          imported.push(insertedLead?.[0]?.id);
        }
      } catch (error) {
        console.error(`Exception importing ${lead.business_name}:`, error);
        results.errors++;
      }
    }

    return NextResponse.json({
      success: true,
      imported: results.imported,
      skipped: results.skipped,
      errors: results.errors,
      importedLeadIds: imported,
      message: `✅ Imported ${results.imported} leads. Skipped ${results.skipped} duplicates. Errors: ${results.errors}`,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
