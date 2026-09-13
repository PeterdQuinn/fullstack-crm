const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => load(path.resolve(path.dirname(file), name + '.ts')), URL, URLSearchParams, AbortSignal, fetch, console, Date, setTimeout });
  return exports;
}
(async () => {
  const types = load('lib/insurance/types.ts');
  const { prospectInput, searchInput } = load('lib/insurance/validation.ts');
  const { searchInsurance, normalizeSources } = load('lib/insurance/search.ts');
  const { insuranceDraft, refineInsuranceDraft } = load('lib/insurance/draft.ts');
  assert.equal(types.licenseAgeDays(null), null);
  assert.equal(types.licenseAgeDays('2026-02-30'), null);
  assert.equal(types.licenseAgeDays('2099-01-01'), null);
  assert.equal(types.safePublicUrl('javascript:alert(1)'), '');
  assert.throws(() => searchInput({ track: 'buyers', state: 'CA' }));
  const record = { track: 'recruiting', state: 'AZ', name: 'Example', source: { url: 'https://example.com/profile', title: 'Example' } };
  assert.equal(prospectInput(record, true).first_licensed_on, null);
  assert.throws(() => prospectInput({ ...record, first_licensed_on: '2026-01-01' }, true));
  assert.throws(() => prospectInput({ ...record, stage: 'Policy issued' }, false));
  assert.equal(normalizeSources([{ title: 'A', link: 'https://example.com/a?utm_source=x' }, { title: 'B', link: 'https://example.com/a' }, { title: 'Unsafe', link: 'javascript:alert(1)' }]).length, 1);
  let calls = 0;
  const result = await searchInsurance({ track: 'recruiting', state: 'AZ', query: 'agent' }, {
    serpKey: 'test', ollamaKey: 'test', reserve: async () => true,
    fetch: async url => { calls++; return url.includes('ollama') ? { ok: false, status: 429 } : { ok: true, json: async () => ({ organic_results: [{ title: 'Example', url: 'https://example.com', content: 'Public profile' }] }) }; },
  });
  assert.equal(result.provider, 'serpapi'); assert.equal(result.sources.length, 1); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(() => searchInsurance({ track: 'buyers', state: 'OH', query: '' }, { serpKey: 'test', reserve: async () => false, fetch: async () => { calls++; } }));
  assert.equal(calls, 0, 'quota denial makes no network call');
  const base = insuranceDraft({ name: 'Unknown', track: 'recruiting', stage: 'Research' });
  assert.ok(base.body.includes(types.BOOKING_URL));
  assert.throws(() => insuranceDraft({ track: 'buyers', stage: 'Do not contact' }));
  const fallback = await refineInsuranceDraft(base, '', { keys: ['test'], reserve: async () => true, fetch: async () => { throw new Error('secret test'); } });
  assert.equal(fallback.provider, 'template'); assert.ok(!fallback.warning.includes('secret'));
  console.log('PASS insurance validation, unknown license dates, deduplication, search fallback, quota, suppression, and instant draft fallback');
})().catch(error => { console.error(error); process.exit(1); });
