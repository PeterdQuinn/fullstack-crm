// HVAC-specific intelligence pulled off a contractor's own website.
//
// The generic scrape (phone/email/owner) tells you who they are. These signals
// tell you what to SELL them: every field maps to a concrete revenue gap a
// contractor can act on, so outreach can cite the gap instead of guessing.

export interface HvacSignals {
  online_booking?: boolean;
  emergency_24_7?: boolean;
  financing?: boolean;
  maintenance_plan?: boolean;
  free_estimates?: boolean;
  brands: string[];
  certifications: string[];
  services: string[];
  segments: string[];
  license_numbers: string[];
  service_areas: string[];
  has_ssl: boolean;
  mobile_friendly?: boolean;
  runs_ads_or_tracking?: boolean;
  review_widget?: boolean;
  chat_widget?: boolean;
}

const has = (html: string, re: RegExp) => re.test(html);

const BRANDS = [
  "Trane", "Carrier", "Lennox", "Goodman", "Rheem", "York", "Daikin",
  "Mitsubishi", "Bryant", "American Standard", "Amana", "Ruud", "Bosch",
];

const CERTS: Array<[string, RegExp]> = [
  ["NATE certified", /\bNATE[\s-]*(certified|certification)?\b/i],
  ["EPA 608", /\bEPA\b[^.]{0,20}\b608\b|\bEPA[\s-]*certified\b/i],
  ["BBB accredited", /\bbetter business bureau\b|\bBBB[\s-]*(accredited|rating|a\+)/i],
  ["ACCA member", /\bACCA\b|air conditioning contractors of america/i],
  ["Energy Star partner", /energy[\s-]*star/i],
  ["Factory authorized dealer", /factory[\s-]*authorized|authorized[\s-]*dealer|premier[\s-]*dealer/i],
];

const SERVICES: Array<[string, RegExp]> = [
  ["AC repair", /\b(a\/?c|air conditioning)[\s-]*(repair|service)\b/i],
  ["AC installation", /\b(a\/?c|air conditioning|system)[\s-]*(install|replacement)/i],
  ["Heating / furnace", /\b(furnace|heating|heat pump)\b/i],
  ["Ductwork", /\bduct(work|s|\b|[\s-]*(cleaning|sealing|repair)?)/i],
  ["Mini-split", /mini[\s-]*split|ductless/i],
  ["Indoor air quality", /indoor air quality|\bIAQ\b|air purif|uv[\s-]*light/i],
  ["Water heater", /water[\s-]*heater|tankless/i],
  ["Thermostat / smart controls", /thermostat|nest|ecobee/i],
];

const SEGMENTS: Array<[string, RegExp]> = [
  ["Residential", /residential|homeowner/i],
  ["Commercial", /commercial|business[\s-]*owner|light[\s-]*commercial/i],
  ["New construction", /new[\s-]*construction/i],
];

// Absence of evidence is not evidence of absence: on a page too thin to have
// said anything, every boolean stays undefined ("unknown") instead of false, so
// outreach never cites a gap that was really just an unread page.
export const MIN_TEXT_FOR_SIGNALS = 800;

export function extractHvacSignals(html: string, bodyText: string): HvacSignals {
  const t = bodyText || html;
  const thin = t.replace(/\s+/g, " ").trim().length < MIN_TEXT_FOR_SIGNALS;
  const maybe = (v: boolean) => (thin ? undefined : v);
  return {
    online_booking: maybe(has(html, /book\s*(now|online|appointment)|schedule\s*(online|service|now)|request\s*service\s*online|online\s*scheduling/i),),
    emergency_24_7: maybe(has(t, /24[\s\/-]*7|24[\s-]*hour|emergency\s*(service|repair|hvac|ac)|after[\s-]*hours/i),),
    financing: maybe(has(t, /financ(e|ing)|payment\s*plan|\bno\b[^.]{0,15}\binterest\b|apply\s*for\s*credit|as\s*low\s*as\s*\$?\d+\s*\/?\s*mo/i),),
    maintenance_plan: maybe(has(t, /maintenance\s*(plan|agreement|program)|service\s*(plan|agreement|club)|membership|tune[\s-]*up\s*plan/i),),
    free_estimates: maybe(has(t, /free\s*(estimate|quote|consultation|second\s*opinion)/i),),
    brands: BRANDS.filter((b) => new RegExp(`\\b${b.replace(/ /g, "[\\s-]*")}\\b`, "i").test(t)),
    certifications: CERTS.filter(([, re]) => re.test(t)).map(([name]) => name),
    services: SERVICES.filter(([, re]) => re.test(t)).map(([name]) => name),
    segments: SEGMENTS.filter(([, re]) => re.test(t)).map(([name]) => name),
    license_numbers: [...new Set((t.match(/\b(?:ROC|License|Lic\.?|Contractor'?s?\s*License)[\s#:.]*(\d{5,8})\b/gi) || [])
      .map((m) => m.trim()).slice(0, 4))],
    service_areas: [],
    has_ssl: true, // set by the caller from the resolved URL protocol
    mobile_friendly: maybe(has(html, /<meta[^>]+name=["']viewport["']/i),),
    runs_ads_or_tracking: maybe(has(html, /googletagmanager|gtag\(|google-analytics|fbq\(|facebook\.net\/.*fbevents|clarity\.ms/i),),
    review_widget: maybe(has(html, /birdeye|podium|nicejob|reviews?\.io|trustpilot|grade\.us|yotpo/i),),
    chat_widget: maybe(has(html, /tawk\.to|intercom|drift\.com|livechat|podium|olark|tidio|hubspot.*conversations/i),),
  };
}

// The gaps worth money, in the order a salesperson should lead with.
export function hvacGaps(s: HvacSignals): string[] {
  const gaps: string[] = [];
  if (s.online_booking === false) gaps.push("No online booking — every job request depends on someone answering the phone");
  if (s.emergency_24_7 === false) gaps.push("No 24/7 or emergency messaging — after-hours calls go to competitors");
  if (s.financing === false) gaps.push("No financing offered — high-ticket replacements stall at the quote");
  if (s.maintenance_plan === false) gaps.push("No maintenance plan — no recurring revenue between seasons");
  if (s.mobile_friendly === false) gaps.push("Site is not mobile-friendly — most HVAC searches happen on a phone");
  if (s.runs_ads_or_tracking === false) gaps.push("No analytics or ad tracking — they cannot tell which jobs came from the site");
  if (s.review_widget === false) gaps.push("Reviews not surfaced on the site — social proof sits only on Google");
  if (s.chat_widget === false) gaps.push("No chat or instant capture — visitors leave without a lead record");
  if (s.certifications.length === 0) gaps.push("No certifications shown (NATE/EPA/BBB) — weaker trust than competitors that display them");
  return gaps;
}
