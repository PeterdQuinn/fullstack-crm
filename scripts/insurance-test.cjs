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
    { exports, require: name => load(name.startsWith('@/')
        ? path.resolve(process.cwd(), name.slice(2) + '.ts')
        : path.resolve(path.dirname(file), name + '.ts')),
      URL, URLSearchParams, AbortSignal, fetch, console, Date, setTimeout, process });
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

  // ── outreach ────────────────────────────────────────────────────────────
  // The copy that reaches a stranger, and the rules about who may receive it.
  // Everything below is loaded with the network and the database stubbed: what
  // is under test is the decision, not the delivery.
  const sent = [];
  cache.set(path.resolve('lib/resend.ts'), { sendEmail: async (to, subject) => { sent.push({ to, subject }); return { id: 'test-message' }; } });
  cache.set(path.resolve('lib/email-templates.ts'), { COMPANY_MAILING_ADDRESS: '535 E Southern Ave Ste 6, Mesa, AZ 85204', mailingAddressConfigured: () => true });
  const saved = [];
  cache.set(path.resolve('lib/insurance/db.ts'), {
    insuranceDb: () => ({ from: () => ({ upsert: async (row) => { saved.push(row); return { error: null }; } }) }),
    reserveInsuranceRequest: async () => true,
    INSURANCE_MONTHLY_CAP: 100,
  });
  const { renderInsuranceEmail, sendRefusal, sendInsuranceTouch, insuranceUnsubscribeUrl } = load('lib/insurance/outreach.ts');

  const person = { id: '11111111-1111-4111-8111-111111111111', name: 'Dana Reyes', track: 'recruiting', state: 'AZ', email: 'dana@example.com', stage: 'Qualified', score: 70, email_sent_count: 0 };

  const touch1 = renderInsuranceEmail(person);
  assert.equal(touch1.touch, 1);
  assert.ok(touch1.html.includes(insuranceUnsubscribeUrl(person.id)), 'every message carries a working unsubscribe link');
  assert.ok(touch1.bodyText.includes('535 E Southern Ave'), 'CAN-SPAM postal address is present');
  assert.ok(touch1.html.includes(types.BOOKING_URL));
  assert.ok(touch1.html.includes('Hi Dana,'), 'a usable first name is used');
  for (const title of ['Producer Directory Listing 2026', 'Best Life Insurance Agents Near Me', 'Reyes Insurance Agency LLC', 'dana_reyes', 'Top 10 Producers In Arizona Reviewed']) {
    assert.ok(renderInsuranceEmail({ ...person, name: title }).html.includes('Hi there,'),
      `a page title is never greeted as a first name: ${title}`);
  }
  // Claims about the RECIPIENT that the data cannot support at the moment they
  // read it. Peter describing himself as a licensed agent is a fact about the
  // sender and stays.
  for (const touch of [0, 1, 2]) {
    for (const track of ['recruiting', 'buyers']) {
      const body = renderInsuranceEmail({ ...person, track, email_sent_count: touch }).bodyText.toLowerCase();
      for (const forbidden of [
        '$', 'guarantee', 'free leads', 'qualified leads', 'commission split', 'six figure',
        'your license', 'your npn', 'newly licensed', 'you are shopping', 'you\'re shopping',
        'carrier appointment', 'we know you', 'i saw that you need',
      ]) {
        assert.ok(!body.includes(forbidden), `touch ${touch + 1} (${track}) must not claim "${forbidden}"`);
      }
    }
  }
  assert.equal(renderInsuranceEmail({ ...person, email_sent_count: 5 }).touch, 3, 'the sequence never runs past three touches');

  // Who may not be mailed, and why.
  assert.equal(sendRefusal(person, 40), null);
  assert.equal(sendRefusal({ ...person, email: '' }, 40), 'no email address');
  assert.equal(sendRefusal({ ...person, opt_out: true }, 40), 'asked not to be contacted');
  assert.equal(sendRefusal({ ...person, stage: 'Do not contact' }, 40), 'asked not to be contacted');
  assert.equal(sendRefusal({ ...person, complained: true }, 40), 'asked not to be contacted');
  assert.equal(sendRefusal({ ...person, bounced: true }, 40), 'address failed');
  assert.equal(sendRefusal({ ...person, replied_at: '2026-09-01T00:00:00Z' }, 40), 'already replied');
  assert.equal(sendRefusal({ ...person, email_sent_count: 3 }, 40), 'sequence complete');
  assert.equal(sendRefusal({ ...person, stage: 'Meeting booked' }, 40), 'stage is closed');
  assert.equal(sendRefusal({ ...person, score: null }, 40), 'not qualified yet');
  assert.equal(sendRefusal({ ...person, score: 39 }, 40), 'not qualified yet');

  const outcome = await sendInsuranceTouch(person, { dailyCap: 10, minScore: 40 });
  assert.equal(outcome.sent, true);
  assert.equal(saved[0].insurance_prospect_id, person.id, 'the outbox row carries the prospect so finalization can do the bookkeeping');
  assert.equal(saved[0].idempotency_key, `ins-${person.id}-touch-1`, 'a replay reuses one key rather than mailing twice');
  assert.equal(saved[0].send_limit, 10);
  const refused = await sendInsuranceTouch({ ...person, opt_out: true }, { dailyCap: 10, minScore: 40 });
  assert.equal(refused.sent, false);
  assert.equal(sent.length, 1, 'a refused send never reaches the provider');


  // ── source policy ───────────────────────────────────────────────────────
  // The first live run imported ten LinkedIn profiles and ten quote farms and
  // produced zero contactable leads. These are the rules that stop that.
  const sources = load('lib/insurance/sources.ts');
  for (const junk of ['https://quickquote.com/az', 'https://www.insuranceopedia.com/best', 'https://www.statefarm.com/agent/us/az/phoenix/dale-wilson', 'https://www.indeed.com/q-insurance-agent', 'https://financial-advisorpro.com/term-life-mesa']) {
    assert.equal(sources.isImportable(junk), false, `must refuse ${junk}`);
  }
  for (const keep of ['https://mycornerstoneinsurance.com/about/', 'https://www.linkedin.com/in/chajon', 'https://www.experience.com/reviews/john-7318415']) {
    assert.equal(sources.isImportable(keep), true, `must keep ${keep}`);
  }
  assert.equal(sources.sourceKind('https://www.linkedin.com/in/chajon'), 'profile');
  assert.equal(sources.sourceKind('https://www.experience.com/reviews/john-7318415'), 'directory');
  assert.equal(sources.sourceKind('https://mycornerstoneinsurance.com/about/'), 'agency');
  assert.equal(sources.sourceKind('https://someagency.com/blog/best-life-insurance-2026'), 'content');

  // How a record can actually be worked, which is what the board shows.
  assert.equal(sources.reachability({ email: 'a@b.com', phone: '' }).channel, 'email');
  assert.equal(sources.reachability({ email: '', phone: '(602) 555-0100' }).channel, 'phone');
  const manual = sources.reachability({ email: '', phone: '', source: { url: 'https://www.linkedin.com/in/x' } });
  assert.equal(manual.channel, 'manual');
  assert.match(manual.note, /Profile network/);

  // The hosted search API returned NOTHING for queries loaded with quotes and
  // OR operators, so the curated set must stay plain.
  for (const track of ['recruiting', 'buyers']) {
    for (const template of sources.DEFAULT_QUERIES[track]) {
      assert.ok(!/["]|\bOR\b|site:|intitle:/.test(template), `query must not use search operators: ${template}`);
      assert.ok(template.includes('{state}'), `query must be state-aware: ${template}`);
    }
  }
  assert.equal(sources.buildQuery('insurance agent {state} contact', 'Arizona'), 'insurance agent Arizona contact');

  console.log('PASS insurance validation, unknown license dates, deduplication, search fallback, quota, suppression, instant draft fallback, outreach copy, send refusals, one-key sends, source filtering, and reachability');
})().catch(error => { console.error(error); process.exit(1); });
