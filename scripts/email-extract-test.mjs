#!/usr/bin/env node
// The email extractor, against the shapes that actually cost sends.
//
// Every case here is taken from a live lead site measured on 2026-09-12, when
// 17 of 20 sites with a published address returned nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".email-extract-build");
fs.rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["tsc", "lib/email-extract.ts", "--outDir", out,
  "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  "--skipLibCheck"], { cwd: root, stdio: "inherit" });

const { bestEmail, findEmails, decodeCloudflareEmail } =
  await import(`file://${path.join(out, "email-extract.js")}`);

/** Encode like Cloudflare does, so the fixture is provably the real format. */
function cfEncode(email, key = 0x2a) {
  let hex = key.toString(16).padStart(2, "0");
  for (const ch of email) hex += (ch.charCodeAt(0) ^ key).toString(16).padStart(2, "0");
  return hex;
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

// Cloudflare obfuscation: the address exists only as XOR-encoded hex.
const cf = cfEncode("info@aircareaz.com");
check("decodes a Cloudflare payload", decodeCloudflareEmail(cf), "info@aircareaz.com");
check("Cloudflare-protected mailto",
  bestEmail(`<a href="/cdn-cgi/l/email-protection#${cf}"><span class="__cf_email__" data-cfemail="${cf}">[email&#160;protected]</span></a>`, "aircareaz.com"),
  "info@aircareaz.com");
check("rejects a corrupt Cloudflare payload", decodeCloudflareEmail("zzzz"), null);

// Markup the old body-text scan could not see.
check("JSON-LD email",
  bestEmail('<script type="application/ld+json">{"@type":"Organization","email":"office@chapmanair.com"}</script>', "chapmanair.com"),
  "office@chapmanair.com");
check("meta tag email",
  bestEmail('<meta name="email" content="info@example-hvac.com">', "example-hvac.com"),
  "info@example-hvac.com");
check("entity-encoded mailto",
  bestEmail('<a href="&#109;ailto:hello@dandhac.com">Email us</a>', "dandhac.com"),
  "hello@dandhac.com");
check("[at]/[dot] obfuscation",
  bestEmail("<p>Reach us at info [at] sprinklerwork [dot] com</p>", "sprinklerwork.com"),
  "info@sprinklerwork.com");

// Ranking: what gets mailed when a page offers several addresses.
check("own domain beats a vendor address",
  bestEmail(`<a href="mailto:eben@eyebytes.com">site by eyebytes</a><a href="mailto:info@cowboyair.com">contact</a>`, "cowboyair.com"),
  "info@cowboyair.com");
check("a vendor-only page yields nothing",
  bestEmail('<footer>Website by <a href="mailto:eben@eyebytes.com">EyeBytes</a></footer>', "cowboyair.com"),
  null);
check("a consumer mailbox is still the business",
  bestEmail('<a href="mailto:comforthvacsd@gmail.com">Email</a>', "comfortac.net"),
  "comforthvacsd@gmail.com");
check("role inbox beats a personal one",
  bestEmail('<a href="mailto:bob@acme-hvac.com">Bob</a><a href="mailto:info@acme-hvac.com">Office</a>', "acme-hvac.com"),
  "info@acme-hvac.com");

// Junk that must never reach the leads table.
check("sprite reference is not an address", bestEmail('<img src="logo@2x.png">', "acme.com"), null);
check("theme placeholder is rejected", bestEmail('<a href="mailto:email@greenlawnfertilizing.com">x</a>', "greenlawnfertilizing.com"), null);
check("noreply is rejected", bestEmail('<a href="mailto:noreply@acme.com">x</a>', "acme.com"), null);
check("Sentry DSN host is rejected", bestEmail('<script>"https://abc@o123.ingest.sentry.io/1"</script>', "acme.com"), null);
check("empty html", bestEmail("", "acme.com"), null);
check("no site host keeps directory behaviour",
  bestEmail('<a href="mailto:someone@thirdparty.com">x</a>', undefined),
  "someone@thirdparty.com");
check("every distinct address is returned once",
  findEmails('<a href="mailto:info@acme.com">a</a><p>info@acme.com</p>', "acme.com").length, 1);

console.log(failed === 0 ? "\nPASS email extraction" : `\nFAIL ${failed} email extraction check(s)`);
process.exit(failed === 0 ? 0 : 1);
