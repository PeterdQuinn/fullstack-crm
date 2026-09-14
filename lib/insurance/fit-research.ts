import { assessLanguages, retainLanguageEvidence, type LanguageAssessment } from "./languages";
import { getChain, runChainJson } from '@/lib/ai-providers';
import { insuranceDb, reserveInsuranceRequest } from './db';
import { searchInsurance } from './search';
import { assessFit, fitPrompt, type FitEvidence, type TargetProfile } from './fit';
import { safePublicUrl, type InsuranceProspect } from './types';

export async function researchInsuranceFit(person: InsuranceProspect & { language_assessment?: LanguageAssessment }, profile: TargetProfile, expand = true) {
  const evidence: FitEvidence[] = [];
  const now = new Date().toISOString();
  const sourceUrl = safePublicUrl(person.source?.url);
  if (sourceUrl && person.source?.snippet) evidence.push({ ...person.source, url: sourceUrl, observed_at: null });
  let warning = '';
  if (expand) {
    try {
      const found = await searchInsurance({ track: person.track, state: person.state, query: `${person.name.slice(0, 100)} ${profile.search_terms.slice(0, 60)}` }, {
        reserve: reserveInsuranceRequest, serpKey: process.env.SERPAPI_API_KEY, ollamaKey: process.env.PRODUCERFORGE_OLLAMA_API_KEY,
      });
      for (const source of found.sources) if (source.snippet && !evidence.some(e => e.url === source.url)) evidence.push({ ...source, observed_at: found.searchedAt });
      warning = found.warning || '';
    } catch (error) { warning = error instanceof Error ? error.message : 'Additional search unavailable'; }
  }
  const result = evidence.length ? await runChainJson<{ checks: unknown[] }>(getChain('scoring'), fitPrompt(profile, person, evidence), {
    label: 'insurance-company-fit', validate: p => !!p && Array.isArray(p.checks),
  }) : null;
  if (evidence.length && !result) throw new Error('Fit research could not complete: no AI provider returned a valid assessment. Previous assessment was preserved.');
  const assessment = assessFit(profile, person, evidence, result?.data, result?.provider || 'no-evidence');
  const { error } = await insuranceDb().from('insurance_prospects').update({ fit_assessment: assessment, ...(person.track === 'recruiting' ? { language_assessment: retainLanguageEvidence(person.language_assessment, assessLanguages(person.name, evidence.map(e => ({ url: e.url, title: e.title, text: e.snippet, kind: 'search_excerpt' as const })))) } : {}), updated_at: now }).eq('id', person.id);
  if (error) throw new Error(`Could not save company fit: ${error.message}`);
  const required = assessment.checks.filter(check => check.kind === 'required');
  const score = assessment.verdict === 'not_fit' ? 0 : Math.round(100 * required.filter(check => check.result === 'supported').length / required.length);
  const { error: scoreError } = await insuranceDb().rpc('save_insurance_score', { p_id: person.id, p_score: {
    score, reason: `${assessment.verdict.replaceAll('_', ' ')}: ${assessment.next_step}`.slice(0, 200), confidence: assessment.confidence, provider: assessment.provider,
  } });
  if (scoreError) throw new Error(`Assessment saved, but qualification could not update: ${scoreError.message}`);
  const { error: logError } = await insuranceDb().from('insurance_activities').insert({ prospect_id: person.id, kind: 'scored', summary: `Company fit: ${assessment.verdict.replaceAll('_', ' ')}`, detail: { assessment, warning } });
  if (logError) warning = [warning, 'Assessment saved; timeline entry could not be recorded'].filter(Boolean).join('; ');
  return { assessment, score, warning };
}
