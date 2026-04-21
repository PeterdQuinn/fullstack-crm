import { NextRequest, NextResponse } from "next/server";

const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;

const TITLE_KEYWORDS = [
  "owner", "co-owner", "founder", "co-founder", "president", "ceo",
  "principal", "proprietor", "managing director", "general manager",
];

// Words that look like names but aren't — block them
const FALSE_POSITIVE_NAMES = /^(Every|Our|Your|The|This|That|Their|Many|Most|Some|All|Meet|About|Contact|With|From|Since|Over|Under|New|Old|General|Special|Total|Full|Main|Head|Lead|Senior|Junior)$/i;

function findPhone(html: string): string | null {
  // tel: href links first — most reliable
  const telMatches = html.match(/href=["']tel:([0-9+\-\s().]{7,20})["']/gi) || [];
  const telNumbers = telMatches.map((m) =>
    m.replace(/href=["']tel:/i, "").replace(/["']/, "").trim()
  );

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");

  const matches = [...telNumbers, ...(stripped.match(PHONE_RE) || [])];
  if (matches.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const m of matches) {
    const clean = m.trim();
    counts[clean] = (counts[clean] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function findOwner(html: string): string | null {
  // 1. JSON-LD schema — most reliable when present
  const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ""));
      const entries = Array.isArray(json) ? json : [json];
      for (const entry of entries) {
        // founder / employee with ownership role
        for (const field of ["founder", "employee", "member", "personnel"]) {
          const val = entry[field];
          if (val) {
            const people = Array.isArray(val) ? val : [val];
            for (const p of people) {
              if (p?.name && typeof p.name === "string") return p.name;
            }
          }
        }
        // direct name on Person schema
        if (entry["@type"] === "Person" && entry.name) return entry.name;
      }
    } catch {}
  }

  // 2. Meta tags (some sites put owner/author there)
  const metaAuthor = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i);
  if (metaAuthor?.[1]) return metaAuthor[1];

  return null;
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  return res.text();
}

export async function POST(req: NextRequest) {
  const { website } = await req.json();
  if (!website) return NextResponse.json({ phone: null, owner: null, error: "No website provided" });

  const url = website.startsWith("http") ? website : `https://${website}`;

  try {
    const html = await fetchHtml(url);

    const phone = findPhone(html);
    let owner = findOwner(html);

    // If no owner found on homepage, try /about page
    if (!owner) {
      try {
        const base = new URL(url);
        const aboutHtml = await fetchHtml(`${base.origin}/about`);
        owner = findOwner(aboutHtml);
      } catch {}
    }

    return NextResponse.json({ phone, owner });
  } catch (e: any) {
    return NextResponse.json({ phone: null, owner: null, error: e.message || "Fetch failed" });
  }
}
