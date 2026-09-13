// When two records are the same person.
//
// The same agency reached the board twice under two URLs — one page about whole
// life, one about universal life, both carrying june@junelifeinsurance.com.
// Source-URL deduplication cannot see that; only the contact details can.
//
// The danger runs the other way too. Five producers at one agency publish ONE
// office number, so merging on a shared phone would quietly delete four real
// people. A phone match is therefore only a duplicate when the names agree as
// well, and "Rebecca Lythgoe Huddleston" and "Beckey Huddleston" do not agree by
// any rule this file is willing to apply — a human can merge those by eye.

/** Lowercased, trimmed, no display name. `""` when there is nothing usable. */
export function normalizeEmail(value?: string | null): string {
  const email = (value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/** The last ten digits of a US number, or `""`. */
export function normalizePhone(value?: string | null): string {
  const digits = (value || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? ten : "";
}

// Credentials and suffixes that are not part of a name.
const NAME_NOISE =
  /\b(clu|chfc|cfp|lutcf|cpcu|fss|ricp|cltc|mba|jr|sr|ii|iii|iv|insurance|agent|agency|producer|broker|llc|inc)\b/gi;

/** Comparable name tokens: lowercased words, credentials and punctuation gone. */
export function nameTokens(value?: string | null): string[] {
  return (value || "")
    .replace(/[®™]/g, " ")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .replace(NAME_NOISE, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[-']+|[-']+$/g, ""))
    .filter((token) => token.length > 1);
}

/**
 * True when two names are confidently the same person.
 *
 * Equal token sets, or one set entirely contained in the other — "Jeremy Smith"
 * and "Jeremy Smith, CLU" agree; "Rebecca Huddleston" and "Beckey Huddleston"
 * do not. A shared surname alone is never enough: agencies are full of
 * relatives.
 */
export function sameName(a?: string | null, b?: string | null): boolean {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return false;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size < 2) return false; // one token is a first name or a surname, not an identity
  for (const token of small) if (!large.has(token)) return false;
  return true;
}

export interface DedupeCandidate {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
}

/**
 * The existing record this one duplicates, or null.
 *
 * An email match is decisive: a personal or office mailbox belongs to one
 * business. A phone match only counts alongside a name match, because a shared
 * office line says the two records work at the same place, not that they are the
 * same person.
 */
export function findDuplicate(record: DedupeCandidate, others: DedupeCandidate[]): { of: DedupeCandidate; reason: "email" | "phone and name" } | null {
  const email = normalizeEmail(record.email);
  const phone = normalizePhone(record.phone);
  if (!email && !phone) return null;

  for (const other of others) {
    if (other.id === record.id) continue;
    if (email && normalizeEmail(other.email) === email) return { of: other, reason: "email" };
  }
  for (const other of others) {
    if (other.id === record.id) continue;
    if (phone && normalizePhone(other.phone) === phone && sameName(record.name, other.name)) {
      return { of: other, reason: "phone and name" };
    }
  }
  return null;
}

/**
 * Of two duplicates, the one to keep.
 *
 * The older record wins — it carries whatever notes, stage and history have
 * accumulated. A tie goes to the one holding an email address, since that is
 * the record that can be sequenced.
 */
export function survivor<T extends DedupeCandidate>(a: T, b: T): { keep: T; merge: T } {
  const aTime = Date.parse(a.created_at || "") || 0;
  const bTime = Date.parse(b.created_at || "") || 0;
  if (aTime !== bTime) return aTime < bTime ? { keep: a, merge: b } : { keep: b, merge: a };
  const aMailable = Boolean(normalizeEmail(a.email));
  const bMailable = Boolean(normalizeEmail(b.email));
  if (aMailable !== bMailable) return aMailable ? { keep: a, merge: b } : { keep: b, merge: a };
  return { keep: a, merge: b };
}
