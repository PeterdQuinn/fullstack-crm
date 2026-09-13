"use client";
import { useEffect, useState } from "react";
import { Search, ExternalLink, ArrowRight, Loader2, ShieldCheck, Users, MessageSquare, CalendarDays } from "lucide-react";
import { INSURANCE_STATES, STAGES, BOOKING_URL, INSURANCE_WEBSITE, licenseAgeDays, type InsuranceTrack, type InsuranceState, type InsuranceSource, type InsuranceProspect } from "@/lib/insurance/types";

type SearchResponse = { sources: InsuranceSource[]; provider: string; searchedAt: string; elapsedMs: number; cached: boolean; warning?: string };
type Draft = { subject: string; body: string; provider: string; warning?: string };
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100";
const button = "inline-flex items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50";
async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(`/api/crm/insurance/${path}`, body === undefined ? { cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response" }));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export default function InsurancePage() {
  const [track, setTrack] = useState<InsuranceTrack>("recruiting");
  const [state, setState] = useState<InsuranceState>("AZ");
  const [tab, setTab] = useState<"discover" | "pipeline">("discover");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searchedFor, setSearchedFor] = useState<{ track: InsuranceTrack; state: InsuranceState }>({ track: "recruiting", state: "AZ" });
  const [prospects, setProspects] = useState<InsuranceProspect[]>([]);
  const [selected, setSelected] = useState<InsuranceProspect | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [usage, setUsage] = useState<{ provider: string; used: number }[]>([]);
  const [stageFilter, setStageFilter] = useState("");
  async function load() {
    try { const data = await api("prospects"); setProspects(data.prospects); setUsage(data.usage); setLoaded(true); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  function switchTrack(next: InsuranceTrack) { setTrack(next); setSelected(null); setDraft(null); setResult(null); setStageFilter(""); setQuery(""); setError(""); setNotice(""); }
  async function search(e: React.FormEvent) {
    e.preventDefault(); setBusy("search"); setError(""); setNotice(""); setResult(null);
    try { const data = await api("search", { track, state, query }); setResult(data); setSearchedFor({ track, state }); void load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function saveSource(source: InsuranceSource) {
    setBusy(source.url); setError("");
    try { const data = await api("prospects", { track: searchedFor.track, state: searchedFor.state, name: source.title, source });
      await load(); setSelected(data.prospect); setDraft(null); setTab("pipeline"); setNotice("Saved for review. Confirm the person's identity before outreach."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function saveRecord(e: React.FormEvent) {
    e.preventDefault(); if (!selected) return;
    setBusy("save"); setError(""); setNotice("");
    try { const data = await api("prospects", selected, "PATCH"); setSelected(data.prospect); await load(); setNotice("Changes saved"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function makeDraft(refine = false) {
    if (!selected) return;
    setBusy("draft"); setError("");
    try { setDraft(await api("draft", { id: selected.id, refine })); void load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  function edit(key: keyof InsuranceProspect, value: string | null) { if (selected) { setSelected({ ...selected, [key]: value }); setDraft(null); } }
  const visible = prospects.filter(p => p.track === track && (!stageFilter || p.stage === stageFilter));
  const active = prospects.filter(p => p.track === track && !["Not now", "Do not contact"].includes(p.stage));
  const followups = active.filter(p => p.next_follow_up && p.next_follow_up <= new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" }));
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-teal-700"><ShieldCheck size={16} /> Peter Quinn · Insurance</div><h1 className="text-3xl font-bold tracking-tight text-slate-950">People. Conversations. Growth.</h1><p className="mt-2 text-sm text-slate-500">Recruit producers and research public buyer signals across your five states.</p></div>
      <a className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700" href={BOOKING_URL} target="_blank" rel="noreferrer"><CalendarDays size={16} /> Your booking page <ExternalLink size={14} /></a>
    </header>
    <div className="flex flex-wrap gap-2" aria-label="Insurance workspace">
      {(["recruiting", "buyers"] as const).map(t => <button key={t} disabled={!!busy} onClick={() => switchTrack(t)} className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold ${track === t ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{t === "recruiting" ? <Users size={16} /> : <MessageSquare size={16} />}{t === "recruiting" ? "Producer recruiting" : "Buyer signals"}</button>)}
    </div>
    <section className="grid grid-cols-3 gap-3" aria-label="Pipeline summary">{[["Saved for review", prospects.filter(p => p.track === track && p.stage === "Research").length], ["In progress", active.filter(p => p.stage !== "Research").length], ["Follow-ups due", followups.length]].map(([label, count]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-2xl font-bold text-slate-900">{loaded ? count : "—"}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>)}</section>
    <div className="flex gap-6 border-b border-slate-200">{(["discover", "pipeline"] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`border-b-2 pb-3 text-sm font-semibold ${tab === t ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500"}`}>{t === "discover" ? "Discover" : "Saved pipeline"}</button>)}</div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">{notice}</div>}
    {tab === "discover" ? <section className="space-y-4">
      <form onSubmit={search} className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">{track === "recruiting" ? "Find producer profiles and license sources" : "Find public conversations about insurance"}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">{track === "recruiting" ? "Search a name, NPN, city, or specialty. New-license status requires a documented issue date." : "Review what the source actually says. A search match alone does not establish purchase intent."}</p>
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]"><label className="text-xs font-medium text-slate-600">State<select aria-label="Search state" className={`${field} mt-1`} disabled={!!busy} value={state} onChange={e => { setState(e.target.value as InsuranceState); setResult(null); }}>{Object.entries(INSURANCE_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Search<input className={`${field} mt-1`} value={query} maxLength={160} disabled={!!busy} onChange={e => setQuery(e.target.value)} placeholder={track === "recruiting" ? "Name, NPN, or life insurance producer" : 'e.g. "looking for" "life insurance"'} /></label><button className={`${button} self-end`} disabled={!!busy || !loaded}>{busy === "search" ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />} Search</button></div>
      </form>
      {result && <><div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{result.sources.length} sources · {result.cached ? "Cached search" : "Live search"} · {(result.elapsedMs / 1000).toFixed(1)}s</span><span>{new Date(result.searchedAt).toLocaleString()}</span></div>{result.warning && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{result.warning}</p>}{result.sources.length === 0 && <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">No sources found. Try a name, city, or broader phrase.</p>}<div className="grid gap-4 lg:grid-cols-2">{result.sources.map(source => <article key={source.url} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5"><span className="mb-2 text-xs font-medium text-teal-700">Source to review</span><a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-teal-700">{source.title} <ExternalLink className="inline" size={13} /></a><p className="mt-2 break-all text-xs text-slate-400">{new URL(source.url).hostname}</p><p className="mb-4 mt-3 text-sm leading-relaxed text-slate-600">{source.snippet || "Open the source to review its contents."}</p>{source.published && <p className="mb-3 text-xs text-slate-400">Source date: {source.published}</p>}<button onClick={() => void saveSource(source)} disabled={!!busy} className="mt-auto flex items-center gap-2 self-start text-sm font-semibold text-teal-800">{busy === source.url ? "Saving…" : "Save for review"}<ArrowRight size={15} /></button></article>)}</div></>}
      {!result && !busy && <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center"><Search className="mx-auto mb-3 text-slate-400" size={24} /><p className="text-sm text-slate-500">Search your territory, review the source, then save the people worth a conversation.</p></div>}
    </section> : <section className="grid items-start gap-5 xl:grid-cols-[minmax(260px,1fr)_minmax(340px,1.4fr)]">
      <div className="space-y-3"><label className="block text-xs font-medium text-slate-600">Filter stage<select className={`${field} mt-1`} value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="">All stages</option>{STAGES[track].map(s => <option key={s}>{s}</option>)}</select></label>{visible.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-slate-500">No saved records in this view yet.</p>}{visible.map(p => <button disabled={!!busy} key={p.id} onClick={() => { setSelected(p); setDraft(null); setNotice(""); }} className={`w-full rounded-xl border bg-white p-4 text-left ${selected?.id === p.id ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}><div className="font-semibold text-slate-900">{p.name}</div><div className="mt-2 flex gap-2 text-xs text-slate-500"><span>{p.state}</span><span>·</span><span>{p.stage}</span>{p.next_follow_up && <span>· Follow up {p.next_follow_up}</span>}</div></button>)}</div>
      {selected ? <div className="rounded-xl border border-slate-200 bg-white p-5"><form className="space-y-4" onSubmit={saveRecord}><div className="flex justify-between gap-4"><h2 className="font-semibold text-slate-900">Review & next step</h2><a href={selected.source.url} target="_blank" rel="noreferrer" className="text-sm text-teal-700">Open source <ExternalLink size={13} className="inline" /></a></div><p className="text-xs leading-relaxed text-slate-500">{selected.source.snippet}</p>
        <label className="block text-xs font-medium text-slate-600">Name<input className={`${field} mt-1`} value={selected.name} onChange={e => edit("name", e.target.value)} maxLength={200} required /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-slate-600">Email<input type="email" className={`${field} mt-1`} value={selected.email} onChange={e => edit("email", e.target.value)} /></label><label className="text-xs font-medium text-slate-600">Phone<input className={`${field} mt-1`} value={selected.phone} maxLength={40} onChange={e => edit("phone", e.target.value)} /></label></div>
        {selected.track === "recruiting" && <div className="space-y-3 rounded-lg bg-slate-50 p-3"><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-slate-600">NPN<input className={`${field} mt-1`} value={selected.npn} maxLength={10} onChange={e => edit("npn", e.target.value)} /></label><label className="text-xs font-medium text-slate-600">First licensed date<input type="date" className={`${field} mt-1`} value={selected.first_licensed_on || ""} onChange={e => edit("first_licensed_on", e.target.value || null)} /></label></div><label className="block text-xs font-medium text-slate-600">License evidence URL<input type="url" className={`${field} mt-1`} value={selected.license_source_url} onChange={e => edit("license_source_url", e.target.value)} placeholder="Link to the record supporting the date" /></label><p className="text-xs text-slate-500">{licenseAgeDays(selected.first_licensed_on) === null ? "License age unknown" : `${licenseAgeDays(selected.first_licensed_on)} days since the recorded issue date · verify source before qualifying`}</p></div>}
        <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-slate-600">Stage<select className={`${field} mt-1`} value={selected.stage} onChange={e => edit("stage", e.target.value)}>{STAGES[selected.track].map(s => <option key={s}>{s}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Next follow-up<input type="date" className={`${field} mt-1`} value={selected.next_follow_up || ""} onChange={e => edit("next_follow_up", e.target.value || null)} /></label></div>
        <label className="block text-xs font-medium text-slate-600">Notes<textarea className={`${field} mt-1`} rows={4} maxLength={6000} value={selected.notes} onChange={e => edit("notes", e.target.value)} placeholder="Record verified facts, conversations, and agreed next steps." /></label><button disabled={!!busy} className={button}>{busy === "save" ? "Saving…" : "Save changes"}</button>
      </form><div className="mt-6 border-t border-slate-200 pt-5"><h3 className="text-sm font-semibold text-slate-900">Conversation draft</h3><p className="mt-1 text-xs text-slate-500">Save your changes first. Drafts include your booking link and are not sent automatically.</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={!!busy || selected.stage === "Do not contact"} className={button} onClick={() => void makeDraft()}>Create instant draft</button><button disabled={!!busy || selected.stage === "Do not contact"} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50" onClick={() => void makeDraft(true)}>{busy === "draft" ? "Preparing…" : "Edit with AI"}</button></div>{draft && <div className="mt-4 space-y-3">{draft.warning && <p className="text-xs text-amber-800">{draft.warning}</p>}<label className="block text-xs text-slate-600">Subject<input className={`${field} mt-1`} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label><label className="block text-xs text-slate-600">Message<textarea className={`${field} mt-1`} rows={11} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label><button className="text-sm font-semibold text-teal-800" onClick={() => { void navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`).then(() => setNotice("Draft copied"), () => setError("Could not copy. Select and copy the draft text.")); }}>Copy draft</button></div>}</div></div> : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">Select a saved record to review facts and plan the next conversation.</div>}
    </section>}
    <footer className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400"><a href={INSURANCE_WEBSITE} target="_blank" rel="noreferrer">peterdquinnsr.com</a><span>Monthly requests: {usage.length ? usage.map(u => `${u.provider} ${u.used}/100`).join(" · ") : "0"}</span></footer>
  </main>;
}
