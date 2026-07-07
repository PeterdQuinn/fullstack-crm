"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Phone,
  Mail,
  MessageSquare,
  Send,
  Calendar,
  GraduationCap,
  ChevronRight,
  ArrowRight,
  Flame,
  CalendarCheck,
  UserPlus,
  Sparkles,
  CheckCircle2,
  Download,
  type LucideIcon,
} from "lucide-react";

interface Stats {
  emailQueue: number;
  callQueue: number;
  dmQueue: number;
  replies: number;
  bookings: number;
  onboarding: number;
  actionToday: number;
  meetingsToday: number;
  newLeads: number;
}

const EMPTY_STATS: Stats = {
  emailQueue: 0,
  callQueue: 0,
  dmQueue: 0,
  replies: 0,
  bookings: 0,
  onboarding: 0,
  actionToday: 0,
  meetingsToday: 0,
  newLeads: 0,
};

type QueueKey = "replies" | "callQueue" | "emailQueue" | "dmQueue" | "bookings" | "onboarding";

interface QueueMeta {
  key: QueueKey;
  label: string;
  verb: string; // used by the dynamic primary CTA
  href: string;
  icon: LucideIcon;
  color: string; // icon text color (from shared status theme tokens)
  chip: string; // soft chip background
}

// Order here also breaks ties for the "busiest queue" CTA (earlier = higher priority).
const QUEUES: QueueMeta[] = [
  { key: "replies", label: "Replies", verb: "Respond to replies", href: "/crm/replies", icon: MessageSquare, color: "text-status-warm", chip: "bg-status-warm/10" },
  { key: "callQueue", label: "Calls", verb: "Start calling", href: "/crm/call-queue", icon: Phone, color: "text-status-active", chip: "bg-status-active/10" },
  { key: "emailQueue", label: "Email", verb: "Send emails", href: "/crm/email-queue", icon: Mail, color: "text-status-new", chip: "bg-status-new/10" },
  { key: "dmQueue", label: "DMs", verb: "Send DMs", href: "/crm/dm-queue", icon: Send, color: "text-gold", chip: "bg-gold/10" },
  { key: "bookings", label: "Bookings", verb: "Review bookings", href: "/crm/bookings", icon: Calendar, color: "text-status-meeting", chip: "bg-status-meeting/10" },
  { key: "onboarding", label: "Onboarding", verb: "Onboard clients", href: "/crm/onboarding", icon: GraduationCap, color: "text-status-won", chip: "bg-status-won/10" },
];

export default function UnifiedDashboard() {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 20000);
    return () => clearInterval(interval);
  }, []);

  async function loadStats() {
    try {
      const res = await fetch("/api/crm/stats");
      if (!res.ok) throw new Error("stats fetch failed");
      const data = await res.json();
      setStats({ ...EMPTY_STATS, ...data });
    } catch (error) {
      console.error("Error loading stats:", error);
    } finally {
      setLoaded(true);
    }
  }

  // Dynamic primary action → whichever queue has the most pending items right now.
  const busiest = QUEUES.reduce(
    (top, q) => (stats[q.key] > stats[top.key] ? q : top),
    QUEUES[0]
  );
  const busiestCount = stats[busiest.key];

  const fmt = (n: number) => (loaded ? n.toLocaleString() : "—");

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      {/* Header — deliberately minimal so the 3 numbers own the top of the page. */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Today</h1>
          {/* Rendered only after mount: the local date/locale differs from the
              server's (UTC), which otherwise causes a hydration mismatch. */}
          <p className="text-xs text-gray-400 sm:text-sm" suppressHydrationWarning>
            {loaded
              ? new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
              : " "}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/crm/export-leads"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:text-sm"
          >
            <Download size={15} className="text-gray-500" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">Export</span>
          </a>
          <Link
            href="/crm/discovery"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:text-sm"
          >
            <Sparkles size={15} className="text-gold" />
            <span className="hidden sm:inline">Discover leads</span>
            <span className="sm:hidden">Discover</span>
          </Link>
        </div>
      </div>

      {/* ── 1. THE THREE KEY NUMBERS ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          className="col-span-2 sm:col-span-1"
          icon={Flame}
          value={fmt(stats.actionToday)}
          label="Need action today"
          sub="Replies + calls due"
          accent="text-status-warm"
          chip="bg-status-warm/10"
          hero
        />
        <KpiCard
          icon={CalendarCheck}
          value={fmt(stats.meetingsToday)}
          label="Meetings today"
          accent="text-status-meeting"
          chip="bg-status-meeting/10"
        />
        <KpiCard
          icon={UserPlus}
          value={fmt(stats.newLeads)}
          label="New leads"
          sub="Since yesterday"
          accent="text-status-new"
          chip="bg-status-new/10"
        />
      </div>

      {/* ── 2. ONE PRIMARY ACTION (dynamic → busiest queue) ───────────────── */}
      <div className="mt-5">
        {busiestCount > 0 ? (
          <Link
            href={busiest.href}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-brand px-5 py-4 text-white shadow-sm transition-colors hover:bg-brand-dark"
          >
            <span className="flex items-center gap-3">
              <busiest.icon size={22} strokeWidth={2.4} />
              <span className="text-left">
                <span className="block text-base font-bold leading-tight sm:text-lg">{busiest.verb}</span>
                <span className="block text-xs text-white/80">
                  {busiestCount.toLocaleString()} {busiest.label.toLowerCase()} waiting — your biggest queue
                </span>
              </span>
            </span>
            <ArrowRight size={22} className="shrink-0" />
          </Link>
        ) : (
          <div className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4">
            <CheckCircle2 size={22} className="shrink-0 text-status-won" />
            <span className="text-left">
              <span className="block text-base font-bold text-gray-900">You're all caught up</span>
              <span className="block text-xs text-gray-400">No pending items across your queues right now.</span>
            </span>
          </div>
        )}
      </div>

      {/* ── 3. QUEUES AS A TAPPABLE LIST OF CARDS ─────────────────────────── */}
      <div className="mt-7">
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Queues</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {QUEUES.map((q) => {
            const count = stats[q.key];
            const Icon = q.icon;
            return (
              <Link
                key={q.key}
                href={q.href}
                className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5 transition-all hover:border-gray-300 hover:shadow-sm active:scale-[0.99]"
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${q.chip}`}>
                  <Icon size={20} className={q.color} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{q.label}</span>
                  <span className="block text-xs text-gray-400">
                    {loaded ? `${count} ${count === 1 ? "item" : "items"} to review` : "Loading…"}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span className={`text-lg font-bold ${count > 0 ? "text-gray-900" : "text-gray-300"}`}>
                    {fmt(count)}
                  </span>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-400" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  value,
  label,
  sub,
  accent,
  chip,
  hero = false,
  className = "",
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  sub?: string;
  accent: string;
  chip: string;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 ${className}`}>
      <span className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${chip}`}>
        <Icon size={17} className={accent} strokeWidth={2.3} />
      </span>
      <div className={`font-extrabold tracking-tight text-gray-900 ${hero ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`}>
        {value}
      </div>
      <div className="mt-1 text-sm font-semibold text-gray-700">{label}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
