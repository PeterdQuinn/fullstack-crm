const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => imports[name], process, console, setTimeout });
  return exports;
}
const { retryAutomationDb } = load('lib/automation-db-retry.ts', {});
(async () => {
  let calls = 0;
  const delays = [];
  await retryAutomationDb(async () => ++calls < 3
    ? { error: { message: 'Gateway Timeout' }, status: 504 }
    : { error: null }, async ms => delays.push(ms));
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
  calls = 0;
  const failed = await retryAutomationDb(async () => { calls++; return { error: { message: 'Gateway Timeout' }, status: 504 }; }, async () => {});
  assert.equal(calls, 3);
  assert.ok(failed.error);
  calls = 0;
  await retryAutomationDb(async () => { calls++; return { error: { message: 'Unauthorized' }, status: 401 }; });
  assert.equal(calls, 1);
  for (const permanent of [false, true]) {
    let inserts = 0, stages = 0, updates = 0;
    const ids = [];
    const db = { from: table => {
      const q = {
        select: () => q, eq: () => q,
        single: () => Promise.resolve({ data: { enabled: true }, error: null }),
        upsert: row => { ids.push(row.id); inserts++; return Promise.resolve(inserts === 1 || permanent ? { error: { message: 'Gateway Timeout' }, status: 504 } : { error: null }); },
        update: () => { updates++; return q; },
        then: resolve => resolve({ error: null }),
      };
      return q;
    }};
    const { withAutomationRun } = load('lib/automation-runs.ts', {
      'node:crypto': require('node:crypto'),
      './automation-db-retry': { retryAutomationDb: op => retryAutomationDb(op, async () => {}) },
      'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
      '@supabase/supabase-js': { createClient: () => db },
    });
    process.env.CRON_SECRET = 'test-only';
    const result = await withAutomationRun('process-followups', { headers: { get: () => 'Bearer test-only' } }, async () => {
      stages++; return { ok: true, status: 200, clone: () => ({ json: async () => ({ success: true }) }) };
    });
    assert.equal(new Set(ids).size, 1, 'lost insert response must reuse the same ID');
    assert.equal(stages, permanent ? 0 : 1, 'stage runs once only after persistence succeeds');
    assert.equal(updates, permanent ? 0 : 1);
    assert.equal(result.status, permanent ? 500 : 200);
  }
  console.log('PASS temporary recovery, bounded failure, permanent errors, stable run ID, and single stage execution');
})().catch(error => { console.error(error); process.exit(1); });
