"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, ExternalLink, ArrowRight, Loader2, ShieldCheck, Users, MessageSquare, CalendarDays,
  Play, Pause, Send, Sparkles, CheckCircle2, Clock, AlertTriangle, Mail, Phone, X, Activity,
} from "lucide-react";
import {
  INSURANCE_STATES, STAGES, BOOKING_URL, INSURANCE_WEBSITE, licenseAgeDays,
  type InsuranceTrack, type InsuranceState, type InsuranceSource, type InsuranceProspect,
} from "@/lib/insurance/types";
import { CompanyFit, TargetingForm } from "./_components/CompanyFit";
import type { FitAssessment, TargetProfiles } from "@/lib/insurance/fit";
import { reachability } from "@/lib/insurance/sources";

// The insurance workspace.
//
// One rule shapes this page: nothing here may imply a fact the data does not
// hold. A score is described as a judgment about the SOURCE, never about the
// person. A licence date with no evidence URL cannot be saved. "Sending is on"
// is stated plainly, in the header, at all times, because that is the switch
// that puts mail in a stranger's inbox.

type Prospect = InsuranceProspect & {
  fit_assessment?: FitAssessment;
  company?: string; title?: string; city?: string; website?: string;
  score?: number | null; score_reason?: string; score_confidence?: string; scored_at?: string | null;
  email_sent_count?: number; last_contacted_at?: string | null; replied_at?: string | null;
  opt_out?: boolean; bounced?: boolean; complained?: boolean; suppression_reason?: string;
  enriched_at?: string | null; discovered_by?: string;
  language_assessment?: { status?: string; languages?: string[]; checked_at?: string };
};
type Task = { id: string; prospect_id: string; task_type: string; due_at: string; status: string; notes: string };
type ActivityRow = { id: string; prospect_id: string; kind: string; summary: string; detail: any; actor: string; created_at: string };
type Settings = {
  enabled: boolean; sending_enabled: boolean; autopilot: boolean;
  tracks: string[]; states: string[]; queries: { track: string; query: string }[];
  daily_send_cap: number; sequence_gap_days: number; min_score: number; targeting?: TargetProfiles;
};
type Workspace = {
  settings: Settings | null; prospects: Prospect[]; tasks: Task[]; activities: ActivityRow[];
  usage: { provider: string; used: number }[]; monthlyCap: number;
  stats: { total: number; withEmail: number; qualified: number; contacted: number; replied: number; suppressed: number; unscored: number; sentToday: number; tasksDue: number; merged: number };
  runs: { status: string; started_at: string; result: any }[];
  configured: { search: boolean; fallback: boolean; drafts: boolean; sending: boolean };
  needsMigration?: boolean;
};
type SearchResponse = { sources: InsuranceSource[]; provider: string; searchedAt: string; elapsedMs: number; cached: boolean; warning?: string };
type Draft = { subject: string; body: string; provider: string; warning?: string };
type Preview = { preview: { subject: string; body: string; touch: number }; refusal: string | null };

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100";
const button = "inline-flex items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50";
const ghost = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(`/api/crm/insurance/${path}`, body === undefined
    ? { cache: "no-store" }
    : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response" }));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "bg-slate-100 text-slate-500";
  if (score >= 70) return "bg-emerald-100 text-emerald-900";
  if (score >= 40) return "bg-amber-100 text-amber-900";
  return "bg-slate-200 text-slate-600";
}

function when(value?: string | null): string {
  if (!value) return "";
  const diff = Date.now() - Date.parse(value);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function InsurancePage() {
  const [data, setData] = useState<Workspace | null>(null);
  const [track, setTrack] = useState<InsuranceTrack>("recruiting");
  const [tab, setTab] = useState<"board" | "discover" | "tasks" | "activity">("board");
  const [state, setState] = useState<InsuranceState>("AZ");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searchedFor, setSearchedFor] = useState<{ track: InsuranceTrack; state: InsuranceState }>({ track: "recruiting", state: "AZ" });
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agentOnly, setAgentOnly] = useState(true);
  const [multiStateOnly, setMultiStateOnly] = useState(true);
  const [bilingualOnly, setBilingualOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectTab = useCallback((next: "board" | "discover" | "tasks" | "activity") => {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "board" ? "/insurance/pipeline" : `/insurance/${next}`);
      window.dispatchEvent(new Event("hashchange"));
    }
  }, []);
  useEffect(() => { const sync = () => { const path = window.location.pathname.split("/").filter(Boolean).pop(); const requested = path === "discover" || path === "tasks" || path === "activity" ? path : (window.location.hash.replace("#", "") || "board"); if (requested === "discover" || requested === "tasks" || requested === "activity" || requested === "board") setTab(requested); }; sync(); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);

  const load = useCallback(async () => {
    try {
      const workspace: Workspace = await api("workspace");
      setData(workspace);
      setSelected((current) => (current ? workspace.prospects.find((p) => p.id === current.id) || current : null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const settings = data?.settings;
  const prospects = useMemo(() => (data?.prospects || []).filter((p) => {
    if (p.track !== track) return false;
    if (agentOnly && (!p.npn || !p.name || /agency|company|group|llc|inc\.?$/i.test(p.name))) return false;
    if (multiStateOnly && (p.licenses?.filter((l) => String(l.status || "active").toLowerCase() === "active").length || 0) < 2) return false;
    if (bilingualOnly && p.language_assessment?.status !== "supported") return false;
    return true;
  }), [data, track, agentOnly, multiStateOnly, bilingualOnly]);
  useEffect(() => { setSelectedIds((ids) => ids.filter((id) => prospects.some((p) => p.id === id))); }, [prospects]);
  const stages = STAGES[track] as readonly string[];
  const timeline = useMemo(
    () => (data?.activities || []).filter((a) => !selected || a.prospect_id === selected.id),
    [data, selected]
  );

  async function act(payload: Record<string, unknown>, busyKey: string, successMessage?: string) {
    setBusy(busyKey); setError(""); setNotice("");
    try {
      const response = await api("action", payload);
      await load();
      if (successMessage) setNotice(successMessage);
      return response;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault(); setBusy("search"); setError(""); setNotice(""); setResult(null);
    try {
      setResult(await api("search", { track, state, query }));
      setSearchedFor({ track, state });
      void load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  async function saveSource(source: InsuranceSource) {
    setBusy(source.url); setError("");
    try {
      const saved = await api("prospects", { track: searchedFor.track, state: searchedFor.state, name: source.title, source });
      await load();
      setSelected(saved.prospect); setDraft(null); setPreview(null); selectTab("board");
      setNotice("Saved for review. Confirm who this is before any outreach.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  async function saveRecord(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      const saved = await api("prospects", selected, "PATCH");
      setSelected(saved.prospect); await load(); setNotice("Changes saved");
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  async function makeDraft(refine = false) {
    if (!selected) return;
    setBusy("draft"); setError("");
    try { setDraft(await api("draft", { id: selected.id, refine })); void load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  function edit(key: keyof Prospect, value: string | null) {
    if (selected) { setSelected({ ...selected, [key]: value } as Prospect); setDraft(null); }
  }

  if (data?.needsMigration) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
          <h1 className="flex items-center gap-2 text-lg font-bold text-amber-900"><AlertTriangle size={20} /> The pipeline tables are not installed yet</h1>
          <p className="mt-2 text-sm text-amber-900">Run <code className="rounded bg-amber-100 px-1">supabase/migrations/020_insurance_pipeline.sql</code>, then reload this page.</p>
        </div>
      </main>
    );
  }

  const running = settings?.enabled;
  const sending = settings?.sending_enabled;

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-7">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-teal-700">
            <ShieldCheck size={16} /> The Learning Lantern Academy · Insurance
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">People. Conversations. Growth.</h1>
          <p className="mt-2 text-sm text-slate-500">
            Recruiting and buyer-signal research across {settings?.states?.length || 5} states, discovered, qualified and worked on a schedule.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${running ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-600"}`}>
            {running ? <Play size={13} /> : <Pause size={13} />} Pipeline {running ? "running" : "paused"}
          </span>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${sending ? "bg-rose-100 text-rose-900" : "bg-slate-200 text-slate-600"}`}>
            <Send size={13} /> Sending {sending ? "ON" : "off"}
          </span>
          <a className={ghost} href={BOOKING_URL} target="_blank" rel="noreferrer"><CalendarDays size={15} /> Booking page <ExternalLink size={13} /></a>
        </div>
      </header>

      {/* ── control room ───────────────────────────────────────────────── */}
      {settings && (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Pipeline controls">
          <div className="flex flex-wrap items-end gap-4">
            {([
              ["enabled", "Discovery, enrichment and scoring run on schedule", "Pipeline"],
              ["sending_enabled", "Real email leaves the building", "Sending"],
              ["autopilot", "A 'not interested' reply suppresses the record without a human", "Autopilot"],
            ] as const).map(([key, help, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2" title={help}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-700"
                  checked={Boolean((settings as any)[key])}
                  disabled={!!busy}
                  onChange={(e) => void act({ action: "settings", [key]: e.target.checked }, `set-${key}`)}
                />
                <span className="text-sm font-semibold text-slate-800">{label}</span>
              </label>
            ))}
            <label className="text-xs font-medium text-slate-600">
              Min score to mail
              <input type="number" min={0} max={100} defaultValue={settings.min_score} disabled={!!busy}
                className={`${field} mt-1 w-24`}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== settings.min_score) void act({ action: "settings", min_score: v }, "set-score"); }} />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Daily send cap
              <input type="number" min={1} max={100} defaultValue={settings.daily_send_cap} disabled={!!busy}
                className={`${field} mt-1 w-24`}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== settings.daily_send_cap) void act({ action: "settings", daily_send_cap: v }, "set-cap"); }} />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Days between touches
              <input type="number" min={1} max={30} defaultValue={settings.sequence_gap_days} disabled={!!busy}
                className={`${field} mt-1 w-24`}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== settings.sequence_gap_days) void act({ action: "settings", sequence_gap_days: v }, "set-gap"); }} />
            </label>
            <div className="ml-auto flex flex-wrap gap-2">
              {(["discover", "enrich", "qualify", "send"] as const).map((phase) => (
                <button key={phase} disabled={!!busy} className={ghost}
                  onClick={() => void act({ action: "run", phase }, `run-${phase}`, `Ran ${phase}`)}>
                  {busy === `run-${phase}` ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {phase}
                </button>
              ))}
            </div>
          </div>
          {sending && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-900">
              <AlertTriangle size={14} />
              Sending is on. Qualified records with an address receive up to three touches, {settings.sequence_gap_days} days apart,
              capped at {settings.daily_send_cap} a day across both pipelines.
            </p>
          )}
        </section>
      )}

      {/* ── numbers ────────────────────────────────────────────────────── */}
      {data && (
        <section className="grid grid-cols-3 gap-3 lg:grid-cols-6" aria-label="Pipeline summary">
          {([
            ["Records", data.stats.total], ["Qualified", data.stats.qualified],
            ["With address", data.stats.withEmail], ["Contacted", data.stats.contacted],
            ["Replied", data.stats.replied], ["Sent today", data.stats.sentToday],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-2xl font-bold text-slate-900">{value}</div>
              <div className="mt-1 text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-teal-200 bg-teal-50 p-4" aria-label="Academy workflow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-bold text-teal-950">Your five-state license verification</h2><p className="mt-1 text-xs text-teal-800">Run each public lookup, review the evidence, then save only records that match you.</p></div>
          <div className="flex flex-wrap gap-2">{(["AZ", "MI", "SC", "OH", "VA"] as const).map((code) => <button key={code} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-teal-900 ring-1 ring-teal-200" onClick={() => { selectTab("discover"); setTrack("recruiting"); setState(code); setQuery("Peter Quinn"); }}>{code}</button>)}</div>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-teal-900 md:grid-cols-4"><span><b>1.</b> Set target</span><span><b>2.</b> Discover public records</span><span><b>3.</b> Verify evidence</span><span><b>4.</b> Qualify and contact</span></div>
      </section>

      <section aria-label="Choose a job" className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Start here</p><h2 className="mt-1 text-xl font-bold text-slate-950">What do you need right now?</h2></div>
          <p className="text-xs text-slate-500">Results come from your ProducerForge records, public SBS/state lookups, and documented web evidence.</p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["Find producers", "Search by state, city, NPN, or specialty.", "discover", "recruiting"],
            ["Verify licenses", "Review multi-state license evidence.", "discover", "recruiting"],
            ["Find bilingual producers", "Prioritize documented language evidence.", "discover", "recruiting"],
            ["Work the pipeline", "Review qualified people, tasks, and replies.", "board", "recruiting"],
          ].map(([title, description, destination, selectedTrack]) => (
            <button key={title} className="min-h-[132px] min-w-0 rounded-xl border border-slate-200 p-4 text-left transition hover:border-teal-500 hover:bg-teal-50" onClick={() => { selectTab(destination as any); setTrack(selectedTrack as any); if (title === "Find bilingual producers") setQuery("bilingual insurance producer"); }}>
              <span className="block break-words text-sm font-bold leading-5 text-slate-900">{title}</span><span className="mt-1 block line-clamp-3 break-words text-xs leading-5 text-slate-500">{description}</span><span className="mt-3 block text-xs font-bold text-teal-700">Open →</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── track + tabs ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {(["recruiting", "buyers"] as const).map((value) => (
          <button key={value} disabled={!!busy} onClick={() => { setTrack(value); setSelected(null); setResult(null); }}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold ${track === value ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
            {value === "recruiting" ? <Users size={16} /> : <MessageSquare size={16} />}
            {value === "recruiting" ? "Producer recruiting" : "Buyer signals"}
          </button>
        ))}
        <div className="sticky top-0 z-10 ml-auto flex gap-5 border-b border-slate-200 bg-slate-50 pt-1">
          {(["board", "discover", "tasks", "activity"] as const).map((value) => (
            <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => selectTab(value)}
              className={`border-b-2 pb-2 text-sm font-semibold capitalize ${tab === value ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500"}`}>
              {value === "board" ? "Pipeline" : value === "discover" ? "Discover" : value === "tasks" ? `Tasks${data?.stats.tasksDue ? ` (${data.stats.tasksDue})` : ""}` : "Activity"}
            </button>
          ))}
        </div>
      </div>

      {track === "recruiting" && <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" checked={agentOnly} onChange={(e) => setAgentOnly(e.target.checked)} /> Agents only</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={multiStateOnly} onChange={(e) => setMultiStateOnly(e.target.checked)} /> 2+ active state licenses</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={bilingualOnly} onChange={(e) => setBilingualOnly(e.target.checked)} /> Verified bilingual</label>
        <span className="ml-auto text-slate-500">Showing {prospects.length} matching agents</span>
      </div>}

      <TargetingForm key={`${track}:${JSON.stringify(settings?.targeting?.[track])}`} profile={settings?.targeting?.[track]} busy={!!busy} save={profile => act({ action: "targeting", track, profile }, "targeting", "Targeting saved. Research prospects against these requirements before outreach.")} />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">{notice}</div>}

      {/* ── board ──────────────────────────────────────────────────────── */}
      {tab === "board" && (
        <section className="space-y-3">
          {selectedIds.length > 0 && <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm font-semibold text-teal-900"><span>{selectedIds.length} selected</span><select className="rounded-lg border border-teal-300 bg-white px-2 py-1.5 text-xs" defaultValue="" onChange={(e) => { if (e.target.value) void act({ action: "bulk-stage", ids: selectedIds, stage: e.target.value }, "bulk-stage", `${selectedIds.length} records moved`); }}><option value="">Move to…</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select><button className="ml-auto text-xs underline" onClick={() => setSelectedIds([])}>Clear</button></div>}
          <div className="flex gap-3 overflow-x-auto pb-3">
          {stages.map((stage) => {
            const column = prospects.filter((p) => p.stage === stage);
            return (
              <div key={stage} className="min-w-[250px] flex-1 rounded-xl bg-slate-100 p-2">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{stage}</span>
                  <span className="text-xs font-semibold text-slate-500">{column.length}</span>
                </div>
                <div className="space-y-2">
                  {column.slice(0, 40).map((prospect) => (
                    <div key={prospect.id} className="relative">
                    <input aria-label={`Select ${prospect.name}`} type="checkbox" checked={selectedIds.includes(prospect.id)} onChange={(e) => setSelectedIds((ids) => e.target.checked ? [...ids, prospect.id] : ids.filter((id) => id !== prospect.id))} className="absolute left-2 top-2 z-10 h-4 w-4 accent-teal-700" />
                    <button onClick={() => { setSelected(prospect); setDraft(null); setPreview(null); }}
                      className={`w-full rounded-lg border bg-white p-3 text-left hover:border-teal-500 ${selected?.id === prospect.id ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-semibold text-slate-900">{prospect.name}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${scoreTone(prospect.score)}`}>
                          {prospect.score ?? "—"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{prospect.state}</span>
                        {(() => {
                          const reach = reachability(prospect);
                          return reach.channel === "email"
                            ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Mail size={11} /> email</span>
                            : reach.channel === "phone"
                              ? <span className="inline-flex items-center gap-1 font-semibold text-sky-700"><Phone size={11} /> call</span>
                              : <span className="text-slate-400">no contact yet</span>;
                        })()}
                        {(prospect.email_sent_count || 0) > 0 && <span className="inline-flex items-center gap-1"><Send size={11} />{prospect.email_sent_count}</span>}
                        {prospect.replied_at && <span className="font-semibold text-teal-700">replied</span>}
                      </div>
                    </button></div>
                  ))}
                  {column.length === 0 && <p className="px-2 py-4 text-xs text-slate-400">Nothing here</p>}
                </div>
              </div>
            );
          })}
          </div>
        </section>
      )}

      {/* ── discover ───────────────────────────────────────────────────── */}
      {tab === "discover" && (
        <section className="space-y-4">
          <form onSubmit={search} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">
              {track === "recruiting" ? "Find producer profiles and license sources" : "Find public conversations about insurance"}
            </h2>
            <p className="mb-4 mt-1 text-sm text-slate-500">
              {track === "recruiting"
                ? "Search a name, NPN, city, or specialty. New-license status requires a documented issue date."
                : "Review what the source actually says. A search match alone does not establish purchase intent."}
            </p>
            <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
              <label className="text-xs font-medium text-slate-600">State
                <select aria-label="Search state" className={`${field} mt-1`} disabled={!!busy} value={state}
                  onChange={(e) => { setState(e.target.value as InsuranceState); setResult(null); }}>
                  {Object.entries(INSURANCE_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">Search
                <input className={`${field} mt-1`} value={query} maxLength={160} disabled={!!busy}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={track === "recruiting" ? "Name, NPN, or life insurance producer" : '"looking for" "life insurance"'} />
              </label>
              <button className={`${button} self-end`} disabled={!!busy}>
                {busy === "search" ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />} Search
              </button>
            </div>
          </form>

          {result && (
            <>
              <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span>{result.sources.length} sources · {result.cached ? "Cached" : "Live"} · {(result.elapsedMs / 1000).toFixed(1)}s</span>
                <span>{new Date(result.searchedAt).toLocaleString()}</span>
              </div>
              {result.warning && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{result.warning}</p>}
              <div className="grid gap-4 lg:grid-cols-2">
                {result.sources.map((source) => (
                  <article key={source.url} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
                    <span className="mb-2 text-xs font-medium text-teal-700">Source to review</span>
                    <a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-teal-700">
                      {source.title} <ExternalLink className="inline" size={13} />
                    </a>
                    <p className="mt-2 break-all text-xs text-slate-400">{new URL(source.url).hostname}</p>
                    <p className="mb-4 mt-3 text-sm leading-relaxed text-slate-600">{source.snippet || "Open the source to review its contents."}</p>
                    <button onClick={() => void saveSource(source)} disabled={!!busy}
                      className="mt-auto flex items-center gap-2 self-start text-sm font-semibold text-teal-800">
                      {busy === source.url ? "Saving…" : "Save for review"} <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── tasks ──────────────────────────────────────────────────────── */}
      {tab === "tasks" && data && (
        <section className="space-y-2">
          {data.tasks.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-slate-500">Nothing is due.</p>}
          {data.tasks.map((task) => {
            const prospect = data.prospects.find((p) => p.id === task.prospect_id);
            const due = Date.parse(task.due_at) <= Date.now();
            return (
              <div key={task.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${due ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"}`}>
                  <Clock size={12} /> {due ? "due" : new Date(task.due_at).toLocaleDateString()}
                </span>
                <button className="text-sm font-semibold text-slate-900 hover:text-teal-700"
                  onClick={() => { if (prospect) { setSelected(prospect); selectTab("board"); } }}>
                  {prospect?.name || "Unknown record"}
                </button>
                <span className="text-sm text-slate-500">{task.notes || task.task_type.replace(/_/g, " ")}</span>
                <div className="ml-auto flex gap-2">
                  <button className={ghost} disabled={!!busy}
                    onClick={() => void act({ action: "task", id: task.prospect_id, task_id: task.id, status: "completed" }, task.id, "Task completed")}>
                    <CheckCircle2 size={14} /> Done
                  </button>
                  <button className={ghost} disabled={!!busy}
                    onClick={() => void act({ action: "task", id: task.prospect_id, task_id: task.id, status: "skipped" }, task.id, "Task skipped")}>
                    Skip
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── activity ───────────────────────────────────────────────────── */}
      {tab === "activity" && data && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900"><Activity size={16} /> Everything that happened</h2>
          <ol className="space-y-3">
            {data.activities.slice(0, 60).map((row) => {
              const prospect = data.prospects.find((p) => p.id === row.prospect_id);
              return (
                <li key={row.id} className="flex gap-3 border-l-2 border-slate-200 pl-3 text-sm">
                  <span className="w-16 shrink-0 text-xs text-slate-400">{when(row.created_at)}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{row.kind}</span>
                  <span className="text-slate-700">
                    {prospect && (
                      <button className="font-semibold text-slate-900 hover:text-teal-700"
                        onClick={() => { setSelected(prospect); selectTab("board"); }}>{prospect.name}</button>
                    )}{prospect ? " — " : ""}{row.summary}
                  </span>
                </li>
              );
            })}
            {data.activities.length === 0 && <li className="text-sm text-slate-500">No activity recorded yet.</li>}
          </ol>
        </section>
      )}

      {/* ── detail ─────────────────────────────────────────────────────── */}
      {selected && (
        <section className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>{INSURANCE_STATES[selected.state]}</span>
                  <a href={selected.source.url} target="_blank" rel="noreferrer" className="text-teal-700">Open source <ExternalLink size={11} className="inline" /></a>
                  {selected.discovered_by === "automation" && <span className="rounded bg-slate-100 px-1.5 py-0.5">found by the pipeline</span>}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>

            {selected.track === "recruiting" && <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-indigo-950">License verification</h3><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-indigo-900">{selected.licenses?.length || 0} states found</span></div>
              {selected.licenses?.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{selected.licenses.map((license, index) => <div key={`${license.state}-${license.license_number || index}`} className="rounded-md bg-white p-2.5 text-xs"><div className="flex justify-between font-bold text-slate-900"><span>{license.state}</span><span className="text-emerald-700">{license.status || "Status unknown"}</span></div><div className="mt-1 text-slate-600">{license.line_of_authority?.join(", ") || "Lines not reported"}</div>{license.expires_on && <div className="mt-1 text-slate-500">Expires {license.expires_on}</div>}{license.source_url && <a className="mt-1 block text-teal-700 underline" href={license.source_url} target="_blank" rel="noreferrer">Evidence ↗</a>}</div>)}</div> : <p className="mt-2 text-xs text-indigo-800">No multi-state license records have been verified yet. Use Discover and save the public evidence.</p>}
            </div>}

            <CompanyFit person={selected} profile={settings?.targeting?.[selected.track]} busy={!!busy} research={() => { void (async () => {
              const response = await act({ action: "research-fit", id: selected.id }, "research-fit", "Company-fit assessment saved.");
              if (response?.warning) setNotice(`Assessment saved. ${response.warning}`);
            })(); }} />
            {/* score */}
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${scoreTone(selected.score)}`}>{selected.score ?? "unscored"}</span>
              <p className="flex-1 text-xs text-slate-600">
                {selected.score_reason || "Not yet judged. The score rates how clearly the SOURCE identifies one person worth writing to — never the person's licence, income or intent."}
              </p>
              <button className={ghost} disabled={!!busy} onClick={() => void act({ action: "qualify", id: selected.id }, "qualify", "Scored")}>
                {busy === "qualify" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Score it
              </button>
            </div>

            {/* stage */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {stages.map((stage) => (
                <button key={stage} disabled={!!busy || stage === selected.stage}
                  onClick={() => void act({ action: "stage", id: selected.id, stage }, `stage-${stage}`, `Moved to ${stage}`)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${stage === selected.stage ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:border-slate-400"}`}>
                  {stage}
                </button>
              ))}
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs">
              {(() => {
                const reach = reachability(selected);
                const tone = reach.channel === "email" ? "text-emerald-800" : reach.channel === "phone" ? "text-sky-800" : "text-slate-500";
                const Icon = reach.channel === "phone" ? Phone : Mail;
                return <><Icon size={14} className={tone} /><span className={`font-semibold ${tone}`}>{reach.channel === "email" ? "Emailable" : reach.channel === "phone" ? "Phone only" : "Not reachable yet"}</span><span className="text-slate-500">— {reach.note}</span></>;
              })()}
            </div>
            <form className="space-y-4" onSubmit={saveRecord}>
              <p className="text-xs leading-relaxed text-slate-500">{selected.source.snippet}</p>
              <label className="block text-xs font-medium text-slate-600">Name
                <input className={`${field} mt-1`} value={selected.name} onChange={(e) => edit("name", e.target.value)} maxLength={200} required />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">Email
                  <input type="email" className={`${field} mt-1`} value={selected.email} onChange={(e) => edit("email", e.target.value)} />
                </label>
                <label className="text-xs font-medium text-slate-600">Phone
                  <input className={`${field} mt-1`} value={selected.phone} maxLength={40} onChange={(e) => edit("phone", e.target.value)} />
                </label>
              </div>
              {selected.track === "recruiting" && (
                <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-slate-600">NPN
                      <input className={`${field} mt-1`} value={selected.npn} maxLength={10} onChange={(e) => edit("npn", e.target.value)} />
                    </label>
                    <label className="text-xs font-medium text-slate-600">First licensed date
                      <input type="date" className={`${field} mt-1`} value={selected.first_licensed_on || ""} onChange={(e) => edit("first_licensed_on", e.target.value || null)} />
                    </label>
                  </div>
                  <label className="block text-xs font-medium text-slate-600">License evidence URL
                    <input type="url" className={`${field} mt-1`} value={selected.license_source_url} onChange={(e) => edit("license_source_url", e.target.value)} placeholder="Link to the record supporting the date" />
                  </label>
                  <p className="text-xs text-slate-500">
                    {licenseAgeDays(selected.first_licensed_on) === null
                      ? "License age unknown"
                      : `${licenseAgeDays(selected.first_licensed_on)} days since the recorded issue date · verify the source before qualifying`}
                  </p>
                </div>
              )}
              <label className="block text-xs font-medium text-slate-600">Next follow-up
                <input type="date" className={`${field} mt-1 w-48`} value={selected.next_follow_up || ""} onChange={(e) => edit("next_follow_up", e.target.value || null)} />
              </label>
              <label className="block text-xs font-medium text-slate-600">Notes
                <textarea className={`${field} mt-1`} rows={3} maxLength={6000} value={selected.notes} onChange={(e) => edit("notes", e.target.value)} placeholder="Record verified facts, conversations, and agreed next steps." />
              </label>
              <button disabled={!!busy} className={button}>{busy === "save" ? "Saving…" : "Save changes"}</button>
            </form>
          </div>

          {/* right column: outreach + timeline */}
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Send size={15} /> Outreach</h3>
              <p className="mt-1 text-xs text-slate-500">
                Touch {Math.min((selected.email_sent_count || 0) + 1, 3)} of 3
                {selected.last_contacted_at ? ` · last sent ${when(selected.last_contacted_at)}` : " · nothing sent yet"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={ghost} disabled={!!busy}
                  onClick={async () => { const r = await act({ action: "preview", id: selected.id }, "preview"); if (r) setPreview(r as Preview); }}>
                  {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Preview the next touch
                </button>
                <button className={button} disabled={!!busy || !settings?.sending_enabled}
                  title={settings?.sending_enabled ? "" : "Turn sending on in the controls above"}
                  onClick={() => void act({ action: "send", id: selected.id }, "send", "Sent")}>
                  {busy === "send" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send it now
                </button>
                <button className={ghost} disabled={!!busy} onClick={() => void makeDraft(false)}>Instant draft</button>
                <button className={ghost} disabled={!!busy} onClick={() => void makeDraft(true)}>
                  {busy === "draft" ? "Preparing…" : "Edit with AI"}
                </button>
              </div>
              {preview && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  {preview.refusal && (
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-800">
                      <AlertTriangle size={13} /> Will not send: {preview.refusal}
                    </p>
                  )}
                  <p className="text-xs font-semibold text-slate-700">{preview.preview.subject}</p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-slate-600">{preview.preview.body}</pre>
                </div>
              )}
              {draft && (
                <div className="mt-3 space-y-2">
                  {draft.warning && <p className="text-xs text-amber-800">{draft.warning}</p>}
                  <input className={field} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                  <textarea className={field} rows={9} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                  <button className="text-sm font-semibold text-teal-800"
                    onClick={() => void navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
                      .then(() => setNotice("Draft copied"), () => setError("Could not copy. Select the text instead."))}>
                    Copy draft
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Activity size={15} /> This record's history</h3>
              <form className="mt-3 flex gap-2"
                onSubmit={async (e) => { e.preventDefault(); if (!noteText.trim()) return; await act({ action: "note", id: selected.id, note: noteText }, "note", "Note added"); setNoteText(""); }}>
                <input className={field} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note…" maxLength={4000} />
                <button className={ghost} disabled={!!busy || !noteText.trim()}>Add</button>
              </form>
              <ol className="mt-4 space-y-3">
                {timeline.slice(0, 25).map((row) => (
                  <li key={row.id} className="flex gap-3 border-l-2 border-slate-200 pl-3 text-sm">
                    <span className="w-16 shrink-0 text-xs text-slate-400">{when(row.created_at)}</span>
                    <span className="text-slate-700"><span className="font-semibold">{row.kind}</span> — {row.summary}</span>
                  </li>
                ))}
                {timeline.length === 0 && <li className="text-sm text-slate-500">Nothing recorded yet.</li>}
              </ol>
            </div>
          </div>
        </section>
      )}

      <footer className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400">
        <a href={INSURANCE_WEBSITE} target="_blank" rel="noreferrer">peterdquinnsr.com</a>
        <span>
          {data?.stats.merged ? `${data.stats.merged} merged as duplicates · ` : ""}
          Monthly search requests: {data?.usage.length ? data.usage.map((u) => `${u.provider} ${u.used}/${data.monthlyCap}`).join(" · ") : "0"}
          {data?.runs?.[0] ? ` · last pipeline run ${when(data.runs[0].started_at)} (${data.runs[0].status})` : ""}
        </span>
      </footer>
    </main>
  );
}
