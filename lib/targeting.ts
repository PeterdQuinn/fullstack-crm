export const DEFAULT_NICHES = ["HVAC", "Landscaping", "Plumbing", "Electrical contractors", "Roofing", "Cleaning services", "Auto repair", "Restaurants", "Dentists", "Accounting firms", "Law firms", "Real estate agencies", "Property management", "Gyms", "Salons", "Retail stores", "Manufacturers", "Wholesale distributors", "Logistics companies", "Marketing agencies"];
export const DEFAULT_LOCATIONS = [
  { city: "Phoenix", state: "AZ" }, { city: "Los Angeles", state: "CA" },
  { city: "Houston", state: "TX" }, { city: "Chicago", state: "IL" },
  { city: "Miami", state: "FL" }, { city: "Philadelphia", state: "PA" },
  { city: "New York", state: "NY" }, { city: "Seattle", state: "WA" },
  { city: "Denver", state: "CO" }, { city: "Atlanta", state: "GA" },
  { city: "Charlotte", state: "NC" }, { city: "Boston", state: "MA" },
  { city: "Nashville", state: "TN" }, { city: "Minneapolis", state: "MN" },
  { city: "Las Vegas", state: "NV" }, { city: "Portland", state: "OR" },
];
export function discoveryTerms(niche: string) {
  const value = niche.trim();
  if (!value || value.length > 80 || /[\r\n<>]/.test(value)) throw new Error("Enter a business niche between 1 and 80 characters");
  const filters: Record<string, string[]> = {
    hvac: ['"craft"="hvac"', '"shop"="hvac"', '"craft"="air_conditioning"'],
    landscaping: ['"craft"="gardener"'], plumbing: ['"craft"="plumber"'],
    "electrical contractors": ['"craft"="electrician"'], roofing: ['"craft"="roofer"'],
    restaurants: ['"amenity"="restaurant"'], dentists: ['"amenity"="dentist"'],
    "auto repair": ['"shop"="car_repair"'], salons: ['"shop"="hairdresser"'],
    "law firms": ['"office"="lawyer"'], "accounting firms": ['"office"="accountant"'],
    "real estate agencies": ['"office"="estate_agent"'], gyms: ['"leisure"="fitness_centre"'],
  };
  return { niche: value, terms: [value === "HVAC" ? "HVAC contractor" : value], osmFilters: filters[value.toLowerCase()] || [] };
}
