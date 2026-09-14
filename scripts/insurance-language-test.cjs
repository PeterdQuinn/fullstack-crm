const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
let request = async () => { throw new Error('Unexpected network request in test'); };
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => name.startsWith('@/') ? load(name.slice(2) + '.ts') : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name),
    URL, URLSearchParams, AbortSignal, fetch: (...args) => request(...args), console, Date, setTimeout, process,
  });
  return exports;
}
function stub(file, value) { cache.set(path.resolve(file), value); }
(async () => {
  const lib = load('lib/insurance/languages.ts');
  const now = new Date('2026-09-13T12:00:00Z');
  const source = text => ({ url: 'https://example.com/dana', title: 'Dana Reyes - Insurance Agent', text, kind: 'search_excerpt' });
  const assess = text => lib.assessLanguages('Dana Reyes', [source(text)], now);
  const person = language_assessment => ({ name: 'Dana Reyes', track: 'recruiting', language_assessment });
  const priority = (a, settings) => lib.languagePriority(person(a), settings, now.getTime());
  const spanish = lib.languageTargeting({ enabled: true, preferred_languages: ['español', 'English', 'spanish'] });
  assert.equal(JSON.stringify(spanish.preferred_languages), JSON.stringify(['English', 'Spanish']));
  assert.throws(() => lib.languageTargeting({ enabled: true, preferred_languages: ['invented'] }));
  assert.throws(() => lib.languageTargeting({ enabled: 'yes', preferred_languages: [] }));
  assert.throws(() => lib.languageTargeting({ enabled: true, preferred_languages: Array(5).fill('English') }));
  const bilingual = assess('Dana Reyes speaks English and Spanish. Contact Dana for life insurance.');
  assert.equal(bilingual.status, 'supported');
  assert.equal(priority(bilingual), 0);
  assert.equal(priority(bilingual, spanish), 0);
  assert.equal(bilingual.evidence[0].source_url, 'https://example.com/dana');
  assert.equal(bilingual.evidence[0].quote, 'Dana Reyes speaks English and Spanish');
  assert.equal(priority(assess('Dana Reyes is bilingual.')), 0, 'explicit bilingual declaration does not invent the pair');
  assert.equal(priority(assess('Dana Reyes is bilingual.'), spanish), 1, 'unknown pair needs confirmation for preferred languages');
  assert.equal(assess('Languages spoken: English, Spanish').status, 'supported', 'language list on an individually named search profile');
  assert.equal(assess('Our team speaks English and Spanish.').status, 'possible', 'agency language support is not individual ability');
  assert.equal(assess('Dana Reyes works here. John Smith speaks English and Spanish.').status, 'possible');
  assert.equal(assess('Dana Reyes works with John Smith who speaks English and Spanish.').status, 'possible');
  assert.equal(assess('Dana Reyes is not bilingual.').status, 'unknown');
  assert.equal(assess('Hiring a bilingual insurance agent.').status, 'unknown', 'job requirements are not producer attributes');
  assert.equal(assess('Dana Reyes lives in Phoenix and has a Spanish surname.').status, 'unknown');
  assert.equal(assess('Dana Reyes habla de seguros para familias.').status, 'unknown', 'page language is not ability evidence');
  assert.equal(assess('Dana Reyes speaks English. Dana Reyes speaks Spanish.').status, 'unknown', 'do not combine ambiguous single-language statements into proof of bilingual skill');
  assert.equal(priority(assess('Dana Reyes speaks English and French.'), spanish), 2, 'wrong language pair joins remaining prospects');
  assert.equal(lib.assessLanguages('María López', [{ ...source('María López speaks English and Spanish.'), title: 'María López | Insurance Agent' }], now).status, 'supported');
  assert.equal(lib.assessLanguages('Dana Reyes', [{ ...source('Dana Reyes speaks English and Spanish.'), title: 'John Smith | Insurance Agent' }], now).status, 'unknown');
  assert.equal(lib.assessLanguages('Dana Reyes', [{ ...source('Dana Reyes speaks English and Spanish.'), url: 'javascript:alert(1)' }], now).status, 'unknown');
  assert.equal(lib.languagePriority({ ...person(bilingual), name: 'Other Person' }, undefined, now.getTime()), 2);
  assert.equal(lib.languagePriority({ ...person(bilingual), track: 'buyers' }, undefined, now.getTime()), 2);
  assert.equal(lib.languagePriority(person(bilingual), { enabled: false, preferred_languages: [] }, now.getTime()), 2);
  assert.equal(lib.languagePriority(person(bilingual), undefined, now.getTime() + 31 * 86400000), 2);
  assert.equal(lib.languagePriority(person({ ...bilingual, checked_at: '2099-01-01' }), undefined, now.getTime()), 2);
  const unknown = assess('No information published.');
  assert.equal(lib.retainLanguageEvidence(bilingual, unknown, now.getTime()).checked_at, bilingual.checked_at);
  assert.equal(lib.retainLanguageEvidence(bilingual, unknown, now.getTime() + 31 * 86400000).status, 'unknown');
  assert.equal(lib.recruitingLanguageQuery('life insurance agent', 0), 'life insurance agent bilingual');
  assert.match(lib.recruitingLanguageQuery('life insurance agent', 1), /multilingual/);
  assert.equal(lib.recruitingLanguageQuery('life insurance agent', 2), 'life insurance agent');
  assert.match(lib.recruitingLanguageQuery('life insurance agent', 0, spanish), /English Spanish/);

  // Pipeline integration, with all providers and database writes isolated.
  const writes = [], searches = [], rpcCalls = [];
  let phase = 'discover';
  const producer = { id: 'test-id', name: 'Dana Reyes', track: 'recruiting', source: { url: source('').url, title: source('').title, snippet: '' }, email: '', phone: '', website: '', stage: 'Research' };
  const settings = { tracks: ['recruiting', 'buyers'], states: ['AZ', 'OH'], queries: [], recruiting_languages: lib.DEFAULT_LANGUAGE_TARGETING };
  const chain = table => ({
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: null }),
    single: async () => ({ data: { id: producer.id } }),
    insert(value) { writes.push({ table, value, op: 'insert' }); return this; },
    update(value) { writes.push({ table, value, op: 'update' }); return this; },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
  });
  stub('lib/insurance/db.ts', { insuranceDb: () => ({ from: chain, rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return { data: name === 'next_insurance_target' ? { track: 'recruiting', state: 'AZ', cursor: 0 } : [producer], error: null };
  } }), reserveInsuranceRequest: async () => true });
  stub('lib/insurance/search.ts', { searchInsurance: async opts => { searches.push(opts); return { sources: [{ ...producer.source, snippet: 'Dana Reyes speaks English and Spanish.' }], query: opts.query, provider: 'test' }; } });
  stub('lib/ai-providers.ts', {});
  stub('lib/email-extract.ts', { bestEmail: () => null });
  stub('lib/email-validation.ts', { looksLikeRealEmail: () => false });
  stub('lib/insurance/outreach.ts', {});
  stub('lib/insurance/fit-research.ts', {});
  const pipeline = load('lib/insurance/pipeline.ts');
  await pipeline.discoverInsuranceProspects(settings);
  assert.match(searches[0].query, /bilingual/);
  assert.equal(writes.find(w => w.table === 'insurance_prospects').value.language_assessment.status, 'supported');
  writes.length = 0;
  request = async url => ({ ok: true, url, text: async () => '<html><head><title>Dana Reyes | Agent</title></head><body><p>Dana Reyes speaks English and Spanish.</p><script>Fake text</script></body></html>' });
  await pipeline.enrichInsuranceProspects(3);
  assert.ok(rpcCalls.some(c => c.name === 'insurance_enrichment_candidates' && c.args.p_limit === 3));
  const enriched = writes.find(w => w.table === 'insurance_prospects').value.language_assessment;
  assert.equal(enriched.status, 'supported');
  assert.equal(enriched.page_checked, true);
  assert.ok(enriched.evidence.some(e => e.source_kind === 'webpage'));
  console.log('PASS bilingual evidence attribution, preferred languages, expiry, query rotation, discovery persistence, and webpage enrichment');
})().catch(error => { console.error(error); process.exit(1); });
