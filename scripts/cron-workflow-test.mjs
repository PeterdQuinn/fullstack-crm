import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/cron.yml"), "utf8");
const trigger = workflow.split("      - name: Trigger route")[1];
assert.ok(trigger, "scheduled trigger must exist");
const shell = trigger.split("        run: |\n")[1]
  .split("\n").map(line => line.replace(/^          /, "")).join("\n")
  .replace('${{ steps.pick.outputs.routes }}', "discover-leads");
const deadline = Number(shell.match(/--max-time (\d+)/)?.[1]);
for (const route of fs.readdirSync(path.join(root, "app/api/cron"))) {
  const code = fs.readFileSync(path.join(root, "app/api/cron", route, "route.ts"), "utf8");
  const duration = Number(code.match(/maxDuration\s*=\s*(\d+)/)?.[1] || 0);
  assert.ok(deadline >= duration + 30, `${route}: client must outwait server by at least 30 seconds`);
}
console.log("PASS client deadline exceeds every cron server deadline");

// Execute the actual workflow shell with a fake transport; no network or mail.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-cron-test-"));
try {
  fs.writeFileSync(path.join(temp, "sleep"), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(temp, "curl"), `#!/bin/bash
echo call >> calls
if [ "\${TEST_RECOVER:-}" = "yes" ] && [ "$(wc -l < calls)" -gt 1 ]; then
  printf '%s' '{"success":true}' > body.json
  printf 200
  exit 0
fi
printf '%s' "$TEST_BODY" > body.json
printf '%s' "$TEST_HTTP"
exit "$TEST_EXIT"
`, { mode: 0o755 });
  for (const [name, http, body, exit, expected, message] of [
    ["successful response", "200", '{"success":true}', "0", 0, "completed"],
    ["server error", "500", '{"error":"failure"}', "0", 1, "returned HTTP 500"],
    ["unauthenticated health response", "200", '{"note":"health check"}', "0", 1, "CRON_SECRET is wrong or missing"],
    ["transport timeout", "000", "", "28", 28, "discover-leads transport failed (curl exit 28"],
  ]) {
    fs.writeFileSync(path.join(temp, "calls"), "");
    const result = spawnSync("bash", ["-c", shell], {
      cwd: temp, encoding: "utf8",
      env: { PATH: `${temp}:${process.env.PATH}`, APP_URL: "https://example.invalid",
        CRON_SECRET: "test-only", TEST_BODY: body, TEST_HTTP: http, TEST_EXIT: exit },
    });
    assert.equal(result.status, expected, `${name}: ${result.stderr}`);
    assert.ok(result.stdout.includes(message), `${name}: ${result.stdout}`);
    assert.equal(fs.readFileSync(path.join(temp, "calls"), "utf8"), "call\n", "never automatically repeat a side-effecting request");
    console.log(`PASS ${name}`);
  }
  for (const [name, body, recover, expectedCalls, expectedStatus] of [
    ['pre-start outage recovers', { success: false, stageStarted: false, retryable: true }, 'yes', 2, 0],
    ['persistent outage stops after three attempts', { success: false, stageStarted: false, retryable: true }, '', 3, 1],
    ['started work is never repeated', { success: false, stageStarted: true, retryable: true }, '', 1, 1],
    ['permanent error is never retried', { success: false, stageStarted: false, retryable: false }, '', 1, 1],
  ]) {
    fs.writeFileSync(path.join(temp, 'calls'), '');
    const result = spawnSync('bash', ['-c', shell], { cwd: temp, encoding: 'utf8',
      env: { PATH: `${temp}:${process.env.PATH}`, APP_URL: 'https://example.invalid', CRON_SECRET: 'test-only',
        TEST_BODY: JSON.stringify(body), TEST_HTTP: '500', TEST_EXIT: '0', TEST_RECOVER: recover } });
    assert.equal(result.status, expectedStatus, `${name}: ${result.stdout} ${result.stderr}`);
    assert.equal(fs.readFileSync(path.join(temp, 'calls'), 'utf8').trim().split('\n').length, expectedCalls, name);
    console.log(`PASS ${name}`);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
