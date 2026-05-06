import { NextRequest, NextResponse } from "next/server";
import { DiscoveredLead, deduplicateLeads, normalizeLead } from "@/lib/lead-discovery";

export async function POST(req: NextRequest) {
  try {
    const { state = "CA", city, category, limit = 10 } = await req.json().catch(() => ({}));

    console.log(`🔍 Discovering leads from Yelp: ${state}/${city || "multiple cities"}/${category || "all"}`);

    const discovered: DiscoveredLead[] = [];

    const categories = category ? [category] : ["HVAC", "Landscaping", "Plumbing", "Roofing"];
    const cities = city ? [city] : ["Phoenix", "Mesa", "Chandler"];

    for (const cat of categories) {
      for (const c of cities) {
        if (discovered.length >= limit) break;

        try {
          const results = await simulateYelpSearch(cat, c, state);
          const normalized = results
            .slice(0, limit - discovered.length)
            .map((lead) => normalizeLead(lead));
          discovered.push(...normalized);
        } catch (error) {
          console.error(`Error searching ${cat} in ${c} on Yelp:`, error);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`✓ Found ${discovered.length} leads from Yelp`);

    return NextResponse.json({
      success: true,
      source: "yelp",
      state,
      leads: deduplicateLeads(discovered),
      count: discovered.length,
    });
  } catch (error) {
    console.error("Yelp discovery error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Yelp discovery failed" },
      { status: 500 }
    );
  }
}

// Simulate Yelp search results
async function simulateYelpSearch(category: string, city: string, state: string): Promise<DiscoveredLead[]> {
  const sampleBusinesses = [
    {
      business_name: `Premier ${category} - ${city}`,
      phone: "602-555-0201",
      address: `111 Business Blvd, ${city}, ${state}`,
      city,
      state,
      website: `https://premier-${category.toLowerCase()}-${city.toLowerCase()}.com`,
      rating: 4.6,
      review_count: 87,
      industry: category,
      niche: category,
    },
    {
      business_name: `Top Rated ${category}`,
      phone: "602-555-0202",
      address: `222 Success St, ${city}, ${state}`,
      city,
      state,
      website: `https://toprated${category.toLowerCase()}.com`,
      rating: 4.9,
      review_count: 156,
      industry: category,
      niche: category,
    },
    {
      business_name: `${city} Best ${category} Services`,
      phone: "602-555-0203",
      address: `333 Best Ln, ${city}, ${state}`,
      city,
      state,
      website: `https://best${category.toLowerCase()}${city.toLowerCase()}.com`,
      rating: 4.4,
      review_count: 64,
      industry: category,
      niche: category,
    },
  ];

  return sampleBusinesses as DiscoveredLead[];
}
