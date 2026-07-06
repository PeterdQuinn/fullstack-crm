// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for lead-status colors across the entire CRM.
//
// Every lead `status` (see the CHECK constraint in supabase/schema.sql) maps to
// one semantic category. Categories map to Tailwind theme colors defined once in
// tailwind.config.ts under `colors.status.*`.
//
// DO NOT hardcode status colors anywhere else. Import `getStatusStyle()` and use
// the returned class strings so every page renders a given status identically.
// ─────────────────────────────────────────────────────────────────────────────

export type StatusCategory =
  | "new"
  | "ready"
  | "active"
  | "warm"
  | "meeting"
  | "won"
  | "lost"
  | "dead"
  | "neutral";

export interface StatusStyle {
  category: StatusCategory;
  hex: string;
  /** Full className for a pill/badge (background + text + subtle ring). */
  badge: string;
  /** Solid dot / swatch background. */
  dot: string;
  /** Accent text color only. */
  text: string;
  /** Solid accent background (for bars, left borders, active states). */
  solid: string;
}

// Class strings are written out in full (not composed at runtime) so Tailwind's
// JIT can see them. This file is included in tailwind.config content globs.
const CATEGORY_STYLE: Record<StatusCategory, Omit<StatusStyle, "category">> = {
  new: {
    hex: "#2563EB",
    badge: "bg-status-new/10 text-status-new ring-1 ring-inset ring-status-new/25",
    dot: "bg-status-new",
    text: "text-status-new",
    solid: "bg-status-new",
  },
  ready: {
    hex: "#0D9488",
    badge: "bg-status-ready/10 text-status-ready ring-1 ring-inset ring-status-ready/25",
    dot: "bg-status-ready",
    text: "text-status-ready",
    solid: "bg-status-ready",
  },
  active: {
    hex: "#0284C7",
    badge: "bg-status-active/10 text-status-active ring-1 ring-inset ring-status-active/25",
    dot: "bg-status-active",
    text: "text-status-active",
    solid: "bg-status-active",
  },
  warm: {
    hex: "#D97706",
    badge: "bg-status-warm/10 text-status-warm ring-1 ring-inset ring-status-warm/25",
    dot: "bg-status-warm",
    text: "text-status-warm",
    solid: "bg-status-warm",
  },
  meeting: {
    hex: "#2D5F3A",
    badge: "bg-status-meeting/10 text-status-meeting ring-1 ring-inset ring-status-meeting/25",
    dot: "bg-status-meeting",
    text: "text-status-meeting",
    solid: "bg-status-meeting",
  },
  won: {
    hex: "#059669",
    badge: "bg-status-won/10 text-status-won ring-1 ring-inset ring-status-won/25",
    dot: "bg-status-won",
    text: "text-status-won",
    solid: "bg-status-won",
  },
  lost: {
    hex: "#DC2626",
    badge: "bg-status-lost/10 text-status-lost ring-1 ring-inset ring-status-lost/25",
    dot: "bg-status-lost",
    text: "text-status-lost",
    solid: "bg-status-lost",
  },
  dead: {
    hex: "#64748B",
    badge: "bg-status-dead/10 text-status-dead ring-1 ring-inset ring-status-dead/25",
    dot: "bg-status-dead",
    text: "text-status-dead",
    solid: "bg-status-dead",
  },
  neutral: {
    hex: "#6B7280",
    badge: "bg-status-neutral/10 text-status-neutral ring-1 ring-inset ring-status-neutral/25",
    dot: "bg-status-neutral",
    text: "text-status-neutral",
    solid: "bg-status-neutral",
  },
};

// Every value allowed by the leads.status CHECK constraint → a category.
const STATUS_TO_CATEGORY: Record<string, StatusCategory> = {
  New: "new",
  "Needs Data": "neutral",
  "Ready for AI Summary": "neutral",
  "Ready for Outreach": "ready",
  "Email 1 Sent": "active",
  "Email 2 Sent": "active",
  "Email 3 Sent": "active",
  "DM Needed": "active",
  "DM Sent": "active",
  "Call Needed": "active",
  Called: "active",
  "No Answer": "warm",
  "Follow-Up": "warm",
  "Follow-Up Scheduled": "warm",
  Interested: "warm",
  Replied: "warm",
  "Booking Link Sent": "meeting",
  Booked: "meeting",
  "Onboarding Sent": "meeting",
  "Onboarding Completed": "meeting",
  Won: "won",
  Lost: "lost",
  "No Response": "dead",
  "Do Not Contact": "dead",
  Dead: "dead",
  "Bad Data": "dead",
  "Bad Email": "dead",
};

export function statusCategory(status?: string | null): StatusCategory {
  if (!status) return "neutral";
  return STATUS_TO_CATEGORY[status] ?? "neutral";
}

/** Resolve any lead status to its shared style. Falls back to `neutral`. */
export function getStatusStyle(status?: string | null): StatusStyle {
  const category = statusCategory(status);
  return { category, ...CATEGORY_STYLE[category] };
}
