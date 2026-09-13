export const INSURANCE_STATES = { AZ: "Arizona", SC: "South Carolina", VA: "Virginia", OH: "Ohio", MI: "Michigan" } as const;
export type InsuranceState = keyof typeof INSURANCE_STATES;
export type InsuranceTrack = "recruiting" | "buyers";
export const BOOKING_URL = "https://calendly.com/quinnconsulting/30min";
export const INSURANCE_WEBSITE = "https://peterdquinnsr.com";
export const STAGES = {
  recruiting: ["Research", "Qualified", "Contacted", "Replied", "Meeting booked", "Contracting", "Onboarding", "Active", "Not now", "Do not contact"],
  buyers: ["Research", "Qualified", "Contacted", "Replied", "Meeting booked", "Application", "Policy issued", "Not now", "Do not contact"],
} as const;
export interface InsuranceSource {
  title: string;
  url: string;
  snippet: string;
  published: string | null;
}
export interface InsuranceProspect {
  id: string;
  track: InsuranceTrack;
  state: InsuranceState;
  name: string;
  email: string;
  phone: string;
  npn: string;
  first_licensed_on: string | null;
  license_source_url: string;
  stage: string;
  notes: string;
  next_follow_up: string | null;
  source: InsuranceSource;
  created_at: string;
  updated_at: string;
}

export function safePublicUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    if (!url.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ""; }
}

export function licenseAgeDays(date: string | null, now = new Date()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date || value > now.getTime()) return null;
  return Math.floor((now.getTime() - value) / 86400000);
}
