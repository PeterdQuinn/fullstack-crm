import { NextRequest, NextResponse } from "next/server";
import { DiscoveredLead, deduplicateLeads, normalizeLead } from "@/lib/lead-discovery";

export async function POST(req: NextRequest) {
  try {
    const { state = "CA", limit = 10 } = await req.json().catch(() => ({}));

    console.log(`🔍 Discovering leads from Directories: ${state}`);

    const discovered: DiscoveredLead[] = [];

    try {
      // Scrape state Chamber of Commerce / business directories
      const chamberResults = await scrapeChamberOfCommerce(state);
      discovered.push(...chamberResults.slice(0, limit));
    } catch (error) {
      console.error(`Error scraping Chamber of Commerce for ${state}:`, error);
    }

    console.log(`✓ Found ${discovered.length} leads from Directories`);

    return NextResponse.json({
      success: true,
      source: "directories",
      state,
      leads: deduplicateLeads(discovered.map((lead) => normalizeLead(lead))),
      count: discovered.length,
    });
  } catch (error) {
    console.error("Directory discovery error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Directory discovery failed" },
      { status: 500 }
    );
  }
}

// Simulate Chamber of Commerce / business directory scraping
async function scrapeChamberOfCommerce(state: string): Promise<DiscoveredLead[]> {
  // In production, would scrape actual Chamber of Commerce websites
  // For now, return realistic sample data

  const sampleFromDirectory = [
    {
      business_name: `${state} Chamber Member - HVAC Solutions`,
      phone: "555-0301",
      address: `101 Chamber Plaza, Phoenix, ${state}`,
      city: "Phoenix",
      state,
      website: `https://chamber-member-hvac-${state.toLowerCase()}.com`,
      industry: "HVAC",
      niche: "HVAC",
    },
    {
      business_name: `Registered Contractor - Landscaping Pro`,
      phone: "555-0302",
      address: `202 Trade Way, Phoenix, ${state}`,
      city: "Phoenix",
      state,
      website: `https://registered-landscaping-${state.toLowerCase()}.com`,
      industry: "Landscaping",
      niche: "Landscaping",
    },
    {
      business_name: `Directory Listed - Plumbing Experts`,
      phone: "555-0303",
      address: `303 Business Ct, Phoenix, ${state}`,
      city: "Phoenix",
      state,
      website: `https://directory-plumbing-${state.toLowerCase()}.com`,
      industry: "Plumbing",
      niche: "Plumbing",
    },
  ];

  return sampleFromDirectory as DiscoveredLead[];
}
