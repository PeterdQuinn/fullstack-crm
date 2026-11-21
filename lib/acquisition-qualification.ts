type QualificationLead = {
  pain_point?: string | null;
  lead_internet_observations?: Array<{ evidence_type?: string; value?: string; source_url?: string }>;
};
type QualificationSummary = { main_pain_point?: string; best_attack_angle?: string };
const normalize = (text?: string | null) => (text ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function hasSourcedOperationalNeed(lead: QualificationLead, summary: QualificationSummary) {
  const need = normalize(lead.pain_point);
  if (need.length < 20 || /not established|unable to determine|no known pain|^unknown\b/.test(need)
    || need !== normalize(summary.main_pain_point)) return false;
  const fit = /\b(ai systems consulting|workflow implementation|business automation)\b/i.test(summary.best_attack_angle ?? "");
  return fit && !!lead.lead_internet_observations?.some(observation =>
    observation.evidence_type === "verified" && normalize(observation.value) === need
    && /^https:\/\/[^\s/]+(?:\/|$)/i.test(observation.source_url ?? ""));
}
