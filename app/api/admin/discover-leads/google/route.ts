import { NextRequest, NextResponse } from "next/server";
import { DiscoveredLead, deduplicateLeads, normalizeLead } from "@/lib/lead-discovery";

const INDUSTRIES = [
  { keyword: "HVAC", niche: "HVAC" },
  { keyword: "Heating and Air Conditioning", niche: "HVAC" },
  { keyword: "Landscaping", niche: "Landscaping" },
  { keyword: "Lawn Care", niche: "Landscaping" },
  { keyword: "Plumbing", niche: "Plumbing" },
  { keyword: "Roofing", niche: "Roofing" },
];

const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
  "CA": ["Los Angeles", "San Francisco", "San Diego", "Sacramento", "Fresno"],
  "TX": ["Houston", "Dallas", "Austin", "San Antonio", "Fort Worth"],
  "FL": ["Miami", "Tampa", "Orlando", "Jacksonville", "Tallahassee"],
  "NY": ["New York City", "Buffalo", "Rochester", "Albany", "Syracuse"],
  "IL": ["Chicago", "Aurora", "Rockford", "Joliet", "Naperville"],
  "PA": ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading"],
  "OH": ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron"],
  "GA": ["Atlanta", "Augusta", "Savannah", "Columbus", "Macon"],
  "AZ": ["Phoenix", "Mesa", "Tucson", "Chandler", "Glendale"],
  "NC": ["Charlotte", "Raleigh", "Greensboro", "Winston-Salem", "Durham"],
};

export async function POST(req: NextRequest) {
  try {
    const { state = "CA", city, industry, limit = 10 } = await req.json().catch(() => ({}));

    console.log(`🔍 Discovering leads from Google Business: ${state}/${city || "major cities"}/${industry || "all"}`);

    const discovered: DiscoveredLead[] = [];
    const cities = city ? [city] : MAJOR_CITIES_BY_STATE[state] || [state];
    const industries = industry ? [{ keyword: industry, niche: industry }] : INDUSTRIES;

    for (const city of cities) {
      for (const ind of industries) {
        if (discovered.length >= limit) break;

        try {
          // Simulate Google Business search results
          // In production, would use Playwright + Google Maps or similar
          const searchResults = await simulateGoogleSearch(ind.keyword, city, state);
          const normalized = searchResults
            .slice(0, limit - discovered.length)
            .map((lead) => normalizeLead({ ...lead, niche: ind.niche }));
          discovered.push(...normalized);
        } catch (error) {
          console.error(`Error searching ${ind.keyword} in ${city}:`, error);
        }

        // Rate limit
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`✓ Found ${discovered.length} leads from Google Business`);

    return NextResponse.json({
      success: true,
      source: "google_business",
      state,
      leads: deduplicateLeads(discovered),
      count: discovered.length,
    });
  } catch (error) {
    console.error("Google discovery error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google discovery failed" },
      { status: 500 }
    );
  }
}

// Simulate Google Business search results
// In production, replace with actual Playwright scraping or Google Places API
async function simulateGoogleSearch(
  keyword: string,
  city: string,
  state: string
): Promise<DiscoveredLead[]> {
  // This is a placeholder - returns realistic dummy data
  // In production, would scrape Google Maps or use Places API

  const sampleBusinesses = [
    {
      business_name: `${keyword} Services ${city}`,
      phone: "555-0101",
      address: `123 Main St, ${city}, ${state}`,
      city,
      state,
      website: `https://example-hvac-${city.toLowerCase()}.com`,
      rating: 4.5,
      review_count: 45,
    },
    {
      business_name: `Expert ${keyword} Contractors`,
      phone: "555-0102",
      address: `456 Oak Ave, ${city}, ${state}`,
      city,
      state,
      website: `https://expert-${keyword.toLowerCase()}.com`,
      rating: 4.8,
      review_count: 92,
    },
    {
      business_name: `${city} ${keyword} Pros`,
      phone: "555-0103",
      address: `789 Elm Rd, ${city}, ${state}`,
      city,
      state,
      website: `https://pros-${keyword.toLowerCase()}-${city.toLowerCase()}.com`,
      rating: 4.2,
      review_count: 28,
    },
  ];

  return sampleBusinesses.map((b) => ({
    ...b,
    industry: keyword,
  })) as DiscoveredLead[];
}
