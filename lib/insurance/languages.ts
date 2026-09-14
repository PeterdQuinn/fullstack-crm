import { safePublicUrl } from './types';

/** Language ability is a job skill. Never derive it from names, nationality,
 * location, appearance, or the language in which a page happens to be written. */
export interface LanguageTargeting { enabled: boolean; preferred_languages: string[] }
export const DEFAULT_LANGUAGE_TARGETING: LanguageTargeting = { enabled: true, preferred_languages: [] };
export interface LanguageSource { url: string; title: string; text: string; kind: 'search_excerpt' | 'webpage' }
export interface LanguageEvidence {
  status: 'supported' | 'possible';
  languages: string[];
  quote: string;
  source_url: string;
  source_kind: LanguageSource['kind'];
  attribution: 'individual' | 'unclear';
}
export interface LanguageAssessment {
  version: 1;
  subject_name: string;
  checked_at: string;
  page_checked: boolean;
  status: 'supported' | 'possible' | 'unknown';
  languages: string[];
  evidence: LanguageEvidence[];
}
const ALIASES: Record<string, string[]> = {
  English: ['english', 'inglés', 'ingles'], Spanish: ['spanish', 'español', 'espanol', 'castellano'],
  French: ['french', 'français', 'francais'], Portuguese: ['portuguese', 'português', 'portugues'],
  Mandarin: ['mandarin'], Cantonese: ['cantonese'], Chinese: ['chinese'],
  Vietnamese: ['vietnamese'], Korean: ['korean'], Japanese: ['japanese'],
  Arabic: ['arabic'], Hindi: ['hindi'], Urdu: ['urdu'], Punjabi: ['punjabi'],
  Tagalog: ['tagalog', 'filipino'], Russian: ['russian'], German: ['german'],
  Italian: ['italian'], Polish: ['polish'], Ukrainian: ['ukrainian'],
  Haitian_Creole: ['haitian creole'], ASL: ['american sign language', 'asl'],
};
export const SUPPORTED_LANGUAGES = Object.keys(ALIASES).map(s => s.replaceAll('_', ' '));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (text: string, term: string) => new RegExp(`(?:^|[^\\p{L}])${escape(term)}(?=$|[^\\p{L}])`, 'iu').test(text);
export function languagesIn(text: string): string[] {
  return Object.entries(ALIASES).filter(([, names]) => names.some(name => hasTerm(text, name))).map(([name]) => name.replaceAll('_', ' ')).sort();
}
export function languageTargeting(value: unknown): LanguageTargeting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Language targeting must be an object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.enabled !== 'boolean' || !Array.isArray(raw.preferred_languages) || raw.preferred_languages.length > 4) throw new Error('Set enabled and up to four preferred languages');
  const languages = raw.preferred_languages.map((value: unknown) => {
    if (typeof value !== 'string' || value.length > 40) throw new Error('Invalid preferred language');
    const canonical = Object.entries(ALIASES).find(([key, names]) => [key.replaceAll('_', ' '), ...names].some(alias => alias.toLowerCase() === value.trim().toLowerCase()));
    if (!canonical) throw new Error(`Choose a supported language: ${SUPPORTED_LANGUAGES.join(', ')}`);
    return canonical[0].replaceAll('_', ' ');
  });
  return { enabled: raw.enabled, preferred_languages: [...new Set(languages)].sort() };
}
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const NON_PERSON = /\b(insurance|agency|agents?|producers?|team|directory|best|top|contact|services|group|company|llc|inc|home|about|licensed|bilingual|speaks|languages|profile|reviews|financial|life|health)\b/i;
/** A conservative identity prefix, including names with accents. Never used to guess languages. */
export function profilePersonName(value: string): string {
  const prefix = value.split(/\s+[|–—-]\s+|\s*\|\s*|,/)[0].trim();
  const parts = prefix.split(/\s+/);
  if (NON_PERSON.test(prefix) || parts.length < 2 || parts.length > 4 || !parts.every(word => /^[\p{L}][\p{L}'’.\-]*$/u.test(word))) return '';
  return prefix;
}
const ABILITY = /\b(bilingual|multilingual|fluent(?:ly)?|speaks?|speaking|languages?\s*(?:spoken)?\s*[:：]|habla|idiomas\s*:)\b|\b(?:languages?\s*(?:spoken)?|idiomas)\s*[:：]/i;
const NEGATIVE = /\b(not|isn't|isn’t|doesn't|doesn’t|cannot|can't|can’t|never|no longer)\b|\b(?:seeking|hiring|wanted|required|looking for|must speak|must be|ideal candidate|join our team)\b/i;
const COLLECTIVE = /\b(our team|our staff|our office|we speak|we are bilingual|agents speak|staff speaks|team speaks)\b/i;
const BILINGUAL = /\b(?:bilingual|multilingual)\b/i;

/** Extract explicit declarations only. Each language pair must occur in one
 * attributed statement; English in one source plus Spanish in another is not a pair. */
export function assessLanguages(subjectName: string, sources: LanguageSource[], now = new Date()): LanguageAssessment {
  const person = profilePersonName(subjectName);
  const evidence: LanguageEvidence[] = [];
  for (const source of sources.slice(0, 12)) {
    const url = safePublicUrl(source.url);
    if (!url || !source.text) continue;
    // Keep sentence and paragraph boundaries so another team member's abilities
    // do not become this person's. Work on a bounded amount of fetched text.
    const sentences = source.text.slice(0, 100000).split(/(?:[.!?;]\s+|[\r\n]+)/).map(clean).filter(Boolean);
    for (const statement of sentences) {
      if (statement.length > 700 || !ABILITY.test(statement) || NEGATIVE.test(statement)) continue;
      const languages = languagesIn(statement);
      if (!BILINGUAL.test(statement) && languages.length < 2) continue;
      const named = person ? new RegExp(`(?:^|[^\\p{L}])${escape(person)}(?=$|[^\\p{L}])`, 'iu') : null;
      const identity = named?.exec(statement);
      const afterName = identity ? statement.slice(identity.index + identity[0].length) : '';
      // The declaration must immediately describe this person. A second named
      // subject or a team reference between the name and verb is not attribution.
      const direct = Boolean(identity && /^(?:\s+(?:is|also|a|an|fully|professionally|insurance|agent|producer|who|and|she|he|they|licensed|life|health)){0,8}\s*(?:bilingual|multilingual|speaks?\b|fluent\b|languages?\s*:)/i.test(afterName));
      const profileList = source.kind === 'search_excerpt' && person && profilePersonName(source.title).toLowerCase() === person.toLowerCase()
        && /^(?:languages?(?: spoken)?|idiomas)\s*:/i.test(statement);
      const supported = Boolean((direct || profileList) && !COLLECTIVE.test(statement));
      // Do not attribute explicit claims on a clearly different named profile.
      const sourcePerson = profilePersonName(source.title);
      if (sourcePerson && person && sourcePerson.toLowerCase() !== person.toLowerCase()) continue;
      evidence.push({ status: supported ? 'supported' : 'possible', languages, quote: statement, source_url: url, source_kind: source.kind, attribution: supported ? 'individual' : 'unclear' });
      if (evidence.length >= 12) break;
    }
    if (evidence.length >= 12) break;
  }
  const supported = evidence.filter(e => e.status === 'supported');
  return { version: 1, subject_name: subjectName, checked_at: now.toISOString(), page_checked: sources.some(s => s.kind === 'webpage' && Boolean(s.text)), status: supported.length ? 'supported' : evidence.length ? 'possible' : 'unknown',
    languages: [...new Set(supported.flatMap(e => e.languages))].sort(), evidence };
}
/** 0 = supported bilingual match; 1 = language clue needing confirmation;
 * 2 = everyone else. Bilingual is a priority, never a qualification override. */
export function languagePriority(person: { name: string; track: string; language_assessment?: LanguageAssessment | null }, settings = DEFAULT_LANGUAGE_TARGETING, now = Date.now()): number {
  if (person.track !== 'recruiting' || !settings.enabled) return 2;
  const a = person.language_assessment;
  const age = now - Date.parse(a?.checked_at || '');
  if (!a || a.version !== 1 || a.subject_name !== person.name || !Number.isFinite(age) || age < 0 || age > 30 * 86400000) return 2;
  if (a.evidence.some(e => e.status === 'supported' && settings.preferred_languages.every(lang => e.languages.includes(lang)))) return 0;
  if (a.evidence.some(e => e.status === 'possible' || (e.status === 'supported' && e.languages.length === 0))) return 1;
  return 2;
}
/** One query per discovery run. Two focused runs, then the broader pool. */
export function recruitingLanguageQuery(base: string, cycle: number, settings = DEFAULT_LANGUAGE_TARGETING): string {
  if (!settings.enabled || cycle % 3 === 2) return base;
  const suffix = settings.preferred_languages.length ? settings.preferred_languages.join(' ') : cycle % 3 === 0 ? 'bilingual' : 'multilingual languages spoken';
  return `${base.slice(0, 100)} ${suffix}`.trim();
}

/** Failed or less informative refreshes do not erase still-current evidence.
 * Preserving the original timestamp prevents repeated failures renewing a claim. */
export function retainLanguageEvidence(previous: LanguageAssessment | null | undefined, next: LanguageAssessment, now = Date.now()): LanguageAssessment {
  const age = now - Date.parse(previous?.checked_at || '');
  if (!previous || previous.version !== 1 || previous.subject_name !== next.subject_name || !Number.isFinite(age) || age < 0 || age > 30 * 86400000) return next;
  const rank = { supported: 0, possible: 1, unknown: 2 };
  return rank[previous.status] < rank[next.status] ? previous : next;
}
