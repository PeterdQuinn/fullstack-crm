export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import nlp from "compromise";
import type { WithContext, Organization, Person } from "schema-dts";

// ── constants ─────────────────────────────────────────────────────────────────

const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
const OWNER_TITLES_RE = /\b(owner|co-owner|founder|co-founder|president|ceo|chief executive|principal|proprietor|managing partner|managing director|managing member|general manager|operator)\b/i;
const NAME_RE = /^[A-Z][a-z'-]{1,20}(?: [A-Z][a-z'-]{1,20}){1,2}$/;
const SKIP_RE = /^(About|Meet|Our|The|Contact|Home|Team|Staff|Leadership|Services|Company|Welcome|Mission|Vision|Values|History|Every|Your|Their|Many|Most|Some|All|New|Old|General|Special|Full|Main|Head|Lead|Senior|Junior|Get|Find|Call|Visit|Schedule|More|Less|View)$/i;
const LINK_PATH_RE = /\/(about|contact|team|staff|our-team|about-us|contact-us|who-we-are|meet-the-team|leadership|our-story|company|people|bios?)\b/i;

const STATIC_PATHS = [
  "/contact", "/contact-us", "/about", "/about-us",
  "/team", "/our-team", "/staff", "/leadership",
  "/who-we-are", "/meet-the-team", "/our-story", "/company",
  "/people", "/bio", "/bios",
];

// FSM / booking software signatures
const FSM_SIGNATURES: Array<{ name: string; pattern: RegExp }> = [
  { name: "Jobber",            pattern: /jobber|jobbersites\.com/i },
  { name: "Housecall Pro",     pattern: /housecallpro|housecall pro/i },
  { name: "Service Autopilot", pattern: /serviceautopilot|service autopilot/i },
  { name: "ServiceTitan",      pattern: /servicetitan/i },
  { name: "Aspire",            pattern: /aspirehq|aspireiq|aspire software/i },
  { name: "GorillaDesk",       pattern: /gorilladesk/i },
  { name: "Yardbook",          pattern: /yardbook/i },
  { name: "LMN",               pattern: /lmn-software|lmnsoftware|lmnapp/i },
  { name: "SingleOps",         pattern: /singleops/i },
  { name: "SynkedUP",          pattern: /synkedup/i },
  { name: "MaintainX",         pattern: /maintainx/i },
  { name: "FieldEdge",         pattern: /fieldedge/i },
  { name: "Kickserv",          pattern: /kickserv/i },
  { name: "WorkWave",          pattern: /workwave/i },
  { name: "Commusoft",         pattern: /commusoft/i },
  { name: "Calendly",          pattern: /calendly\.com/i },
  { name: "Square Booking",    pattern: /book\.squareup|squareup\.com\/appointments/i },
  { name: "Acuity",            pattern: /acuityscheduling/i },
  { name: "QuickBooks",        pattern: /quickbooks/i },
];

// CMS / site technology signatures
const TECH_SIGNATURES: Array<{ name: string; pattern: RegExp }> = [
  { name: "WordPress",    pattern: /wp-content|wp-includes|wordpress/i },
  { name: "Squarespace",  pattern: /squarespace\.com|static\.squarespace/i },
  { name: "Wix",          pattern: /wix\.com|wixstatic/i },
  { name: "Shopify",      pattern: /shopify/i },
  { name: "Webflow",      pattern: /webflow\.io|webflow\.com/i },
  { name: "GoDaddy",      pattern: /godaddy/i },
  { name: "Google Sites", pattern: /sites\.google\.com/i },
];

// ── types ─────────────────────────────────────────────────────────────────────

type SocialLinks = {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
};

type PageData = {
  phone: string | null;
  owner: string | null;
  email: string | null;
  current_software: string | null;
  booking_detected: boolean;
  social: SocialLinks;
  technologies: string[];
  description: string | null;
  address: string | null;
};

// ── phone ─────────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string | null {
  const p = parsePhoneNumberFromString(raw.trim(), "US");
  return p?.isValid() ? p.formatNational() : null;
}

function extractPhone($: cheerio.CheerioAPI): string | null {
  let phone: string | null = null;
  // tel: links — most reliable
  $("a[href^='tel:']").each((_, el) => {
    if (phone) return;
    phone = normalizePhone($(el).attr("href")!.replace(/^tel:/i, ""));
  });
  if (phone) return phone;
  // Google knowledge panel: data-attrid containing phone
  $("[data-attrid*='phone'], [data-dtype='d3ifr'], [data-local-attribute='d3ifr']").each((_, el) => {
    if (phone) return;
    const n = normalizePhone($(el).text());
    if (n) phone = n;
  });
  if (phone) return phone;
  // Google spans with aria-label containing phone pattern
  $("span[aria-label]").each((_, el) => {
    if (phone) return;
    const label = $(el).attr("aria-label") || "";
    const n = normalizePhone(label);
    if (n) phone = n;
  });
  if (phone) return phone;
  // Plain text scan
  for (const m of ($("body").text().match(PHONE_RE) || [])) {
    const n = normalizePhone(m);
    if (n) return n;
  }
  return null;
}

// ── email ─────────────────────────────────────────────────────────────────────

function extractEmail($: cheerio.CheerioAPI): string | null {
  let email: string | null = null;
  $("a[href^='mailto:']").each((_, el) => {
    if (email) return;
    const raw = $(el).attr("href")!.replace(/^mailto:/i, "").split("?")[0].trim();
    if (raw.includes("@")) email = raw;
  });
  if (email) return email;
  return ($("body").text().match(EMAIL_RE) || []).find(
    (m) => !m.includes("example.") && !m.includes("yourname")
  ) || null;
}

// ── owner ─────────────────────────────────────────────────────────────────────

function ownerFromJsonLd($: cheerio.CheerioAPI): string | null {
  let owner: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (owner) return;
    try {
      const raw = JSON.parse($(el).text()) as WithContext<Organization | Person> | any[];
      for (const entry of (Array.isArray(raw) ? raw : [raw]) as any[]) {
        if (entry["@type"] === "Person" && typeof entry.name === "string") { owner = entry.name; return; }
        for (const field of ["founder", "employee", "member"]) {
          for (const p of [entry[field]].flat().filter(Boolean)) {
            if (p?.name) { owner = p.name; return; }
          }
        }
      }
    } catch {}
  });
  return owner;
}

function ownerFromText($: cheerio.CheerioAPI): string | null {
  const metaAuthor = $('meta[name="author"]').attr("content")?.trim();
  if (metaAuthor && NAME_RE.test(metaAuthor)) return metaAuthor;

  const text = $("body").text().replace(/\s+/g, " ");

  const inlineRe = /([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[,|–\-]\s*(owner|founder|co-founder|president|ceo|chief executive|principal|proprietor|managing partner|managing director|general manager)/gi;
  const inlineMatch = inlineRe.exec(text);
  if (inlineMatch?.[1] && NAME_RE.test(inlineMatch[1]) && !SKIP_RE.test(inlineMatch[1].split(" ")[0])) {
    return inlineMatch[1];
  }

  const sample = text.slice(0, 8000);
  const people = (nlp(sample).people().out("array") as string[]);
  for (const person of people) {
    if (!NAME_RE.test(person) || SKIP_RE.test(person.split(" ")[0])) continue;
    const idx = sample.indexOf(person);
    if (idx !== -1 && OWNER_TITLES_RE.test(sample.slice(Math.max(0, idx - 150), idx + person.length + 150))) {
      return person;
    }
  }

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => { headings.push($(el).text().replace(/\s+/g, " ").trim()); });
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i], next = headings[i + 1] || "";
    if (NAME_RE.test(h) && !SKIP_RE.test(h.split(" ")[0]) && OWNER_TITLES_RE.test(next)) return h;
    if (OWNER_TITLES_RE.test(h) && NAME_RE.test(next) && !SKIP_RE.test(next.split(" ")[0])) return next;
  }

  return null;
}

// ── software detection ────────────────────────────────────────────────────────

function detectSoftware(html: string): { current_software: string | null; booking_detected: boolean } {
  let current_software: string | null = null;
  let booking_detected = false;

  for (const sig of FSM_SIGNATURES) {
    if (sig.pattern.test(html)) {
      current_software = sig.name;
      booking_detected = true;
      break;
    }
  }

  // Generic booking signals if no named software found
  if (!booking_detected) {
    booking_detected = /book\s*now|schedule\s*online|request\s*a\s*quote\s*online|book\s*an\s*appointment|online\s*scheduling/i.test(html);
  }

  return { current_software, booking_detected };
}

// ── technologies ──────────────────────────────────────────────────────────────

function detectTechnologies(html: string): string[] {
  return TECH_SIGNATURES.filter((t) => t.pattern.test(html)).map((t) => t.name);
}

// ── social links ──────────────────────────────────────────────────────────────

function extractSocial($: cheerio.CheerioAPI): SocialLinks {
  const social: SocialLinks = {};
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!social.facebook && /facebook\.com\//i.test(href)) social.facebook = href;
    if (!social.instagram && /instagram\.com\//i.test(href)) social.instagram = href;
    if (!social.linkedin && /linkedin\.com\//i.test(href)) social.linkedin = href;
    if (!social.twitter && /twitter\.com\/|x\.com\//i.test(href)) social.twitter = href;
  });
  return social;
}

// ── description ───────────────────────────────────────────────────────────────

function extractDescription($: cheerio.CheerioAPI): string | null {
  return $('meta[name="description"]').attr("content")?.trim()
    || $('meta[property="og:description"]').attr("content")?.trim()
    || null;
}

// ── address ───────────────────────────────────────────────────────────────────

function extractAddress($: cheerio.CheerioAPI): string | null {
  // Schema.org PostalAddress
  let addr: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (addr) return;
    try {
      const raw = JSON.parse($(el).text()) as any;
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const e of entries) {
        const a = e.address;
        if (!a) continue;
        const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean);
        if (parts.length >= 2) { addr = parts.join(", "); return; }
      }
    } catch {}
  });
  if (addr) return addr;

  // itemprop address
  const street = $('[itemprop="streetAddress"]').first().text().trim();
  const city = $('[itemprop="addressLocality"]').first().text().trim();
  const state = $('[itemprop="addressRegion"]').first().text().trim();
  if (street || city) return [street, city, state].filter(Boolean).join(", ");

  return null;
}

// ── full page parse ───────────────────────────────────────────────────────────

function parsePage(html: string): PageData {
  const $ = cheerio.load(html);
  const sw = detectSoftware(html);
  return {
    phone:            extractPhone($),
    email:            extractEmail($),
    owner:            ownerFromJsonLd($) || ownerFromText($),
    current_software: sw.current_software,
    booking_detected: sw.booking_detected,
    social:           extractSocial($),
    technologies:     detectTechnologies(html),
    description:      extractDescription($),
    address:          extractAddress($),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function mergeData(base: PageData, next: PageData): PageData {
  return {
    phone:            base.phone || next.phone,
    email:            base.email || next.email,
    owner:            base.owner || next.owner,
    current_software: base.current_software || next.current_software,
    booking_detected: base.booking_detected || next.booking_detected,
    social: {
      facebook:  base.social.facebook  || next.social.facebook,
      instagram: base.social.instagram || next.social.instagram,
      linkedin:  base.social.linkedin  || next.social.linkedin,
      twitter:   base.social.twitter   || next.social.twitter,
    },
    technologies:     [...new Set([...base.technologies, ...next.technologies])],
    description:      base.description || next.description,
    address:          base.address     || next.address,
  };
}

function isComplete(d: PageData): boolean {
  return !!(d.phone && d.owner && d.email);
}

async function isEnglish(html: string): Promise<boolean> {
  try {
    const $ = cheerio.load(html);
    const text = $("body").text().replace(/\s+/g, " ").slice(0, 1000);
    if (text.length < 80) return true;
    const { franc } = await import("franc");
    const lang = franc(text, { minLength: 50 });
    return lang === "eng" || lang === "und";
  } catch { return true; }
}

function discoverLinks(html: string, base: URL): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    try {
      const abs = new URL(href, base.origin).href;
      if (!abs.startsWith(base.origin)) return;
      const path = new URL(abs).pathname;
      if (LINK_PATH_RE.test(path) && !seen.has(abs)) { seen.add(abs); links.push(abs); }
    } catch {}
  });
  return links;
}

function computeScore(d: PageData): number {
  let s = 2; // +2 for having a website (always true here)
  if (d.phone) s += 3;
  if (d.owner) s += 4;
  if (d.email) s += 2;
  if (Object.keys(d.social).length > 0) s += 2;
  if (d.current_software) s += 1;
  return s;
}

function blankData(): PageData {
  return { phone: null, owner: null, email: null, current_software: null, booking_detected: false, social: {}, technologies: [], description: null, address: null };
}

// ── browser launcher ─────────────────────────────────────────────────────────

async function launchBrowser() {
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { chromium: pw } = await import("playwright-core");
    return pw.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

// ── fetchers ──────────────────────────────────────────────────────────────────

async function fetchStatic(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── multi-page crawl ──────────────────────────────────────────────────────────

async function crawlPages(urls: string[]): Promise<PageData[]> {
  const settled = await Promise.allSettled(
    urls.slice(0, 6).map(async (u) => {
      const html = await fetchStatic(u);
      return parsePage(html);
    })
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<PageData> => r.status === "fulfilled")
    .map((r) => r.value);
}

// ── linkedom fallback ─────────────────────────────────────────────────────────

async function linkedomFallback(html: string): Promise<Partial<PageData>> {
  try {
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML(html);
    let phone: string | null = null;
    for (const el of document.querySelectorAll("a[href^='tel:']")) {
      phone = normalizePhone(el.getAttribute("href")?.replace(/^tel:/i, "").trim() || "");
      if (phone) break;
    }
    let owner: string | null = null;
    const bodyText = document.body?.textContent?.replace(/\s+/g, " ") || "";
    const m = /([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[,|–\-]\s*(owner|founder|ceo|president|principal)/gi.exec(bodyText);
    if (m?.[1] && NAME_RE.test(m[1])) owner = m[1];
    return { phone, owner };
  } catch { return {}; }
}

// ── handler ───────────────────────────────────────────────────────────────────

function buildResponse(data: PageData) {
  return NextResponse.json({
    phone:            data.phone,
    owner:            data.owner,
    email:            data.email,
    current_software: data.current_software,
    booking_detected: data.booking_detected,
    facebook_url:     data.social.facebook  || null,
    instagram_url:    data.social.instagram || null,
    linkedin_url:     data.social.linkedin  || null,
    technologies:     data.technologies.join(", ") || null,
    description:      data.description,
    address:          data.address,
    confidence:       computeScore(data),
  });
}

async function playwrightPage(ctx: any, url: string, wait = 2000): Promise<string> {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.waitForTimeout(wait);
    return await page.content();
  } finally { await page.close(); }
}

export async function POST(req: NextRequest) {
  const raw = await req.json();
  const business_name: string = raw.business_name || "";
  const city: string          = raw.city || "";
  const website: string       = (raw.website && raw.website !== "N/A" && raw.website.trim() !== "")
    ? raw.website.trim() : "";

  let data = blankData();

  // ── no website: search directories only ──────────────────────────────────────
  if (!website) {
    if (!business_name) return NextResponse.json({ error: "No website or business name provided", confidence: 0 });

    const q   = encodeURIComponent(`${business_name} ${city} phone number`);
    const yq  = encodeURIComponent(`${business_name} ${city}`);
    const loc = encodeURIComponent(city);

    // DuckDuckGo + YellowPages (static, fast)
    await Promise.allSettled([
      fetchStatic(`https://html.duckduckgo.com/html/?q=${q}`).then((h) => { data = mergeData(data, parsePage(h)); }),
      fetchStatic(`https://www.yellowpages.com/search?search_terms=${yq}&geo_location_terms=${loc}`).then((h) => { data = mergeData(data, parsePage(h)); }),
    ]);

    // Playwright: Google + Bing for knowledge panel
    let browser: any = null;
    try {
      browser = await launchBrowser();
      const ctx = await browser.newContext({ locale: "en-US" });
      for (const searchUrl of [
        `https://www.google.com/search?q=${q}&hl=en`,
        `https://www.bing.com/search?q=${q}`,
      ]) {
        if (data.phone && data.owner) break;
        try {
          data = mergeData(data, parsePage(await playwrightPage(ctx, searchUrl, 1500)));
        } catch {}
      }
    } catch (e) { console.error("[scrape] browser search failed:", e); }
    finally { if (browser) await browser.close().catch(() => {}); }

    return buildResponse(data);
  }

  // ── has website ───────────────────────────────────────────────────────────────
  const url = website.startsWith("http") ? website : `https://${website}`;
  let base: URL;
  try { base = new URL(url); } catch { return NextResponse.json({ error: "Invalid URL", confidence: 0 }); }

  let homeHtml = "";

  // Phase 1 — static homepage
  try { homeHtml = await fetchStatic(url); data = parsePage(homeHtml); } catch {}

  // Phase 2 — static subpages (parallel)
  if (!isComplete(data)) {
    const discovered  = homeHtml ? discoverLinks(homeHtml, base) : [];
    const staticUrls  = STATIC_PATHS.map((p) => `${base.origin}${p}`);
    const candidates  = [...new Set([...discovered, ...staticUrls])].filter((u) => u !== url && u !== `${url}/`);
    try {
      const results = await crawlPages(candidates);
      for (const r of results) { data = mergeData(data, r); if (isComplete(data)) break; }
    } catch {}
  }

  // Phase 3 — single Playwright browser: website crawl + Google search
  let browser: any = null;
  try {
    browser = await launchBrowser();
    const ctx = await browser.newContext({ locale: "en-US" });

    // 3a — crawl website pages (more pages than before)
    if (!isComplete(data)) {
      const targets = [
        url,
        `${base.origin}/contact`,
        `${base.origin}/contact-us`,
        `${base.origin}/about`,
        `${base.origin}/about-us`,
        `${base.origin}/team`,
        `${base.origin}/our-team`,
        `${base.origin}/staff`,
      ];
      for (const target of targets) {
        if (isComplete(data)) break;
        try { data = mergeData(data, parsePage(await playwrightPage(ctx, target, 2000))); } catch {}
      }
    }

    // 3b — Google knowledge panel (run whenever owner OR phone OR address is missing)
    if (business_name && (!data.phone || !data.owner || !data.address)) {
      try {
        const q = encodeURIComponent(`${business_name} ${city}`);
        data = mergeData(data, parsePage(await playwrightPage(ctx, `https://www.google.com/search?q=${q}&hl=en`, 1500)));
      } catch {}
    }

    // 3c — Bing as extra phone/owner source
    if (business_name && (!data.phone || !data.owner)) {
      try {
        const q = encodeURIComponent(`${business_name} ${city} phone`);
        data = mergeData(data, parsePage(await playwrightPage(ctx, `https://www.bing.com/search?q=${q}`, 1000)));
      } catch {}
    }

  } catch (e) { console.error("[scrape] Playwright failed:", e); }
  finally { if (browser) await browser.close().catch(() => {}); }

  // Phase 4 — static directory fallbacks
  if (!data.phone && business_name) {
    const q   = encodeURIComponent(`${business_name} ${city} phone number`);
    const yq  = encodeURIComponent(`${business_name} ${city}`);
    const loc = encodeURIComponent(city);
    await Promise.allSettled([
      fetchStatic(`https://html.duckduckgo.com/html/?q=${q}`).then((h) => { data = mergeData(data, parsePage(h)); }),
      fetchStatic(`https://www.yellowpages.com/search?search_terms=${yq}&geo_location_terms=${loc}`).then((h) => { data = mergeData(data, parsePage(h)); }),
    ]);
  }

  // Phase 5 — linkedom fallback on homepage html
  if ((!data.phone || !data.owner) && homeHtml) {
    const fallback = await linkedomFallback(homeHtml);
    if (!data.phone && fallback.phone) data.phone = fallback.phone;
    if (!data.owner && fallback.owner) data.owner = fallback.owner;
  }

  return buildResponse(data);
}
