import { INSURANCE_STATES, STAGES, safePublicUrl, licenseAgeDays, type InsuranceTrack } from "./types";

export class InsuranceInputError extends Error {}
function text(value: unknown, max: number, label: string): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) throw new InsuranceInputError(`${label} must be text under ${max} characters`);
  return value.trim();
}
export function searchInput(body: Record<string, unknown>) {
  if (body.track !== "recruiting" && body.track !== "buyers") throw new InsuranceInputError("Choose recruiting or buyer signals");
  if (typeof body.state !== "string" || !Object.hasOwn(INSURANCE_STATES, body.state)) throw new InsuranceInputError("Choose AZ, SC, VA, OH, or MI");
  const query = text(body.query, 160, "Search");
  return { track: body.track as InsuranceTrack, state: body.state as keyof typeof INSURANCE_STATES, query };
}
export function prospectInput(body: Record<string, unknown>, creating: boolean) {
  const { track, state } = searchInput(body);
  const name = text(body.name, 200, "Name");
  if (!name) throw new InsuranceInputError("Enter a name or source title");
  const stage = creating ? "Research" : text(body.stage, 40, "Stage");
  if (!(STAGES[track] as readonly string[]).includes(stage)) throw new InsuranceInputError("Invalid pipeline stage");
  const email = text(body.email, 254, "Email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InsuranceInputError("Enter a valid email");
  const npn = text(body.npn, 10, "NPN");
  if (npn && !/^\d{6,10}$/.test(npn)) throw new InsuranceInputError("NPN must contain 6–10 digits");
  const first_licensed_on = text(body.first_licensed_on, 10, "License date") || null;
  if (first_licensed_on && licenseAgeDays(first_licensed_on) === null) throw new InsuranceInputError("Enter an actual past license date");
  const rawLicenseUrl = text(body.license_source_url, 2000, "License source");
  const license_source_url = rawLicenseUrl ? safePublicUrl(rawLicenseUrl) : "";
  if (rawLicenseUrl && !license_source_url) throw new InsuranceInputError("Enter a public license evidence URL");
  if (first_licensed_on && !license_source_url) throw new InsuranceInputError("Add the evidence URL for this license date");
  const next_follow_up = text(body.next_follow_up, 10, "Follow-up date") || null;
  if (next_follow_up && (!/^\d{4}-\d{2}-\d{2}$/.test(next_follow_up) || !Number.isFinite(Date.parse(next_follow_up)) || new Date(next_follow_up).toISOString().slice(0, 10) !== next_follow_up)) throw new InsuranceInputError("Invalid follow-up date");
  const raw = body.source;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InsuranceInputError("A source is required");
  const s = raw as Record<string, unknown>;
  const url = safePublicUrl(s.url);
  if (!url) throw new InsuranceInputError("A public source URL is required");
  return { track: track as InsuranceTrack, state, name, stage, email, npn, first_licensed_on, license_source_url, next_follow_up,
    phone: text(body.phone, 40, "Phone"), notes: text(body.notes, 6000, "Notes"),
    source: { url, title: text(s.title, 300, "Source title"), snippet: text(s.snippet, 2000, "Source excerpt"), published: text(s.published, 100, "Source date") || null } };
}
