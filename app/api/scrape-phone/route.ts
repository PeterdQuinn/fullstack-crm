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

// ── directory / Google search ─────────────────────────────────────────────────

async function searchByName(name: string, city: string): Promise<PageData> {
  const isVercel = !!process.env.VERCEL;
  let merged = blankData();

  // Local: use Playwright to hit Google — knowledge panel has tel: link
  if (!isVercel) {
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const ctx = await browser.newContext({ locale: "en-US" });
        const page = await ctx.newPage();
        const q = encodeURIComponent(`${name} ${city}`);
        await page.goto(`https://www.google.com/search?q=${q}&hl=en`, { waitUntil: "domcontentloaded", timeout: 12000 });
        await page.waitForTimeout(1500);
        merged = mergeData(merged, parsePage(await page.content()));
        await browser.close();
      } catch { await browser.close(); }
    } catch {}
  }

  if (merged.phone) return merged;

  // Fallback: static Yellow Pages
  try {
    const q = encodeURIComponent(`${name} ${city}`);
    const loc = encodeURIComponent(city);
    const html = await fetchStatic(`https://www.yellowpages.com/search?search_terms=${q}&geo_location_terms=${loc}`);
    merged = mergeData(merged, parsePage(html));
  } catch {}

  return merged;
}

// ── handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const raw = await req.json();
  const business_name: string = raw.business_name || "";
  const city: string = raw.city || "";
  // Treat "N/A", empty, or missing as no website
  const website: string = (raw.website && raw.website !== "N/A" && raw.website.trim() !== "") ? raw.website.trim() : "";

  // No website — search directories by name
  if (!website) {
    if (!business_name) return NextResponse.json({ error: "No website or business name provided", confidence: 0 });
    const data = await searchByName(business_name, city || "");
    return NextResponse.json({
      phone:            data.phone,
      owner:            data.owner,
      email:            data.email,
      current_software: data.current_software,
      booking_detected: data.booking_detected,
      facebook_url:     data.social.facebook || null,
      instagram_url:    data.social.instagram || null,
      linkedin_url:     data.social.linkedin || null,
      technologies:     data.technologies.join(", ") || null,
      description:      data.description,
      address:          data.address,
      confidence:       computeScore(data),
    });
  }

  const url = website.startsWith("http") ? website : `https://${website}`;
  let base: URL;
  try { base = new URL(url); } catch {
    return NextResponse.json({ error: "Invalid URL", confidence: 0 });
  }

  let data = blankData();
  let homeHtml = "";

  // Phase 1 — homepage
  try {
    homeHtml = await fetchStatic(url);
    data = parsePage(homeHtml);
  } catch (e) { console.error("[scrape] Phase1 failed:", url, e); }

  // Phase 2 — contact/about/team subpages
  if (!isComplete(data)) {
    const discovered = homeHtml ? discoverLinks(homeHtml, base) : [];
    const staticUrls = STATIC_PATHS.map((p) => `${base.origin}${p}`);
    const candidates = [...new Set([...discovered, ...staticUrls])].filter(
      (u) => u !== url && u !== `${url}/`
    );
    try {
      const subResults = await crawlPages(candidates);
      for (const r of subResults) {
        data = mergeData(data, r);
        if (isComplete(data)) break;
      }
    } catch (e) { console.error("[scrape] Phase2 failed:", e); }
  }

  // Phase 3 — Playwright (local only — Vercel has no Chromium)
  const isVercel = !!process.env.VERCEL;
  if (!isComplete(data) && !isVercel) {
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const ctx = await browser.newContext({ locale: "en-US" });
        const targets = [url, `${base.origin}/contact`, `${base.origin}/about`];
        for (const target of targets) {
          if (isComplete(data)) break;
          try {
            const page = await ctx.newPage();
            await page.goto(target, { waitUntil: "domcontentloaded", timeout: 12000 });
            await page.waitForTimeout(1500);
            data = mergeData(data, parsePage(await page.content()));
            await page.close();
          } catch {}
        }
      } finally { await browser.close(); }
    } catch (e) { console.error("[scrape] Playwright failed:", e); }
  }

  // Phase 4 — Google cache (handles Cloudflare-blocked sites)
  if (!data.phone) {
    try {
      const cacheHtml = await fetchStatic(`https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}&hl=en`);
      data = mergeData(data, parsePage(cacheHtml));
    } catch {}
  }

  // Phase 5 — Google search by business name (knowledge panel has tel: links)
  if (!data.phone && business_name) {
    try {
      const q = encodeURIComponent(`${business_name} ${city || ""}`);
      const gHtml = await fetchStatic(`https://www.google.com/search?q=${q}&num=5&hl=en`);
      const $ = cheerio.load(gHtml);
      const phone = extractPhone($);
      if (phone) data.phone = phone;
      if (!data.email) { const email = extractEmail($); if (email) data.email = email; }
      if (!data.owner) { const owner = ownerFromJsonLd($) || ownerFromText($); if (owner) data.owner = owner; }
      if (!data.address) { const addr = extractAddress($); if (addr) data.address = addr; }
    } catch (e) { console.error("[scrape] Google search failed:", e); }
  }

  // Phase 6 — Yellow Pages + Yelp by business name
  if (!data.phone && business_name) {
    try {
      const dirData = await searchByName(business_name, city || "");
      data = mergeData(data, dirData);
    } catch {}
  }

  // Phase 7 — linkedom fallback on homepage html
  if ((!data.phone || !data.owner) && homeHtml) {
    const fallback = await linkedomFallback(homeHtml);
    if (!data.phone && fallback.phone) data.phone = fallback.phone;
    if (!data.owner && fallback.owner) data.owner = fallback.owner;
  }

  const confidence = computeScore(data);

  return NextResponse.json({
    phone:            data.phone,
    owner:            data.owner,
    email:            data.email,
    current_software: data.current_software,
    booking_detected: data.booking_detected,
    facebook_url:     data.social.facebook || null,
    instagram_url:    data.social.instagram || null,
    linkedin_url:     data.social.linkedin || null,
    technologies:     data.technologies.join(", ") || null,
    description:      data.description,
    address:          data.address,
    confidence,
  });
}
