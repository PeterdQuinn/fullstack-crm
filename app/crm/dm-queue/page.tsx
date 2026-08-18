"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ExternalLink, FlaskConical, Mail, MapPin, Phone, Search, ShieldCheck, Sparkles, X } from "lucide-react";

interface Summary {
  lead_score?: number;
  confidence_level?: string;
  main_pain_point?: string;
  pain_reason?: string;
  best_attack_angle?: string;
  recommended_first_message?: string;
  recommended_follow_up?: string;
  missing_data_needed?: string[];
  updated_at?: string;
}
interface Source { label: string; url: string; }
interface Lead {
  id: string; business_name: string; owner_name?: string; contact_name?: string;
  phone?: string; email?: string; website?: string; address?: string; city?: string;
  state?: string; postal_code?: string; niche?: string; industry?: string; status: string;
  short_description?: string; technologies?: string; current_software?: string;
  monthly_spend_estimate?: string; google_rating?: number; google_review_count?: number;
  ai_summary?: Summary | null; sources: Source[];
}
type Tab = "facts" | "weaknesses" | "sources";

const progressStages = ["Preparing location search", "Checking Google Places", "Checking OpenStreetMap", "Removing duplicates", "Applying quality rules", "Saving new businesses"];
const walkSteps = ["Choose an area", "Run discovery", "Select a business", "Run AI research", "Check every source", "Approve for Email or Calls"];
function clean(value: string) { return value.replaceAll("-", " "); }
function url(value?: string) { if (!value) return ""; return /^https?:\/\//i.test(value) ? value : `https://${value}`; }

export default function ResearchCenterPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("facts");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [walkthrough, setWalkthrough] = useState(false);
  const [walkStep, setWalkStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [form, setForm] = useState({ city: "Mesa", state: "AZ", zip: "", radiusMiles: 15, limit: 10, minimumRating: 0, minimumReviews: 0, requirePhone: true, requireEmail: false, requireWebsite: true });

  async function loadLeads() {
    setLoading(true);
    try {
      const response = await fetch("/api/crm/research-center", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load research leads");
      setLeads(data);
      setSelectedId((current) => current && data.some((lead: Lead) => lead.id === current) ? current : null);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load Research Center"); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadLeads(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => !term || [lead.business_name, lead.owner_name, lead.city, lead.state, lead.email].some((value) => value?.toLowerCase().includes(term)));
  }, [leads, search]);
  const selected = leads.find((lead) => lead.id === selectedId) || null;

  async function manualDiscovery() {
    if (!form.city.trim() || !form.state.trim()) { setError("City and state are required"); return; }
    if (!window.confirm(`Search for up to ${form.limit} HVAC businesses in ${form.city}, ${form.state}?`)) return;
    setWorking(true); setError(""); setNotice(""); setResult(null); setProgress(0); setElapsed(0);
    if (walkthrough) setWalkStep(1);
    const timer = window.setInterval(() => { setElapsed((value) => value + 1); setProgress((value) => Math.min(value + 1, progressStages.length - 1)); }, 4000);
    try {
      const response = await fetch("/api/admin/discover-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, importToDb: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Discovery failed");
      setResult(data);
      setNotice(`Discovery finished. ${data.pipeline?.imported || 0} new businesses saved.`);
      await loadLeads();
      if (walkthrough) setWalkStep(2);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Discovery failed"); }
    finally { window.clearInterval(timer); setWorking(false); setProgress(progressStages.length - 1); }
  }

  async function leadAction(action: "research" | "approve_email" | "move_calls" | "needs_more" | "reject" | "do_not_contact") {
    if (!selected) return;
    if (["reject", "do_not_contact"].includes(action) && !window.confirm(`Apply this decision to ${selected.business_name}?`)) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/crm/research-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: selected.id, action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Research action failed");
      setNotice(action === "research" ? `AI research completed for ${selected.business_name}` : `${selected.business_name} moved successfully`);
      if (walkthrough && action === "research") setWalkStep(4);
      setSelectedId(action === "research" ? selected.id : null);
      await loadLeads();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Research action failed"); }
    finally { setWorking(false); }
  }

  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3"><div className="flex items-center gap-3"><button onClick={() => router.back()} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-100" aria-label="Go back"><ArrowLeft size={20} /></button><div><h1 className="text-xl font-bold sm:text-2xl">Research Center</h1><p className="text-sm text-slate-500">Find weaknesses, verify sources, then choose the next step</p></div></div><button onClick={() => { setWalkthrough(!walkthrough); setWalkStep(0); setShowManual(true); }} className={`hidden min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex ${walkthrough ? "bg-violet-700 text-white" : "bg-violet-100 text-violet-800"}`}><FlaskConical size={18} />Walkthrough</button></div></header>

    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      {walkthrough && <div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-violet-700">Walkthrough step {walkStep + 1} of {walkSteps.length}</div><div className="mt-1 font-semibold text-violet-950">{walkSteps[walkStep]}</div></div><button onClick={() => setWalkthrough(false)} className="rounded-lg p-2 text-violet-700"><X size={19} /></button></div><div className="mt-3 grid grid-cols-6 gap-1">{walkSteps.map((_, index) => <div key={index} className={`h-2 rounded-full ${index <= walkStep ? "bg-violet-600" : "bg-violet-200"}`} />)}</div></div>}
      <button onClick={() => setShowManual(!showManual)} className="mt-4 flex min-h-[48px] w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 font-bold text-blue-900"><span className="flex items-center gap-2"><Search size={19} />Manual Discovery</span><ChevronDown className={showManual ? "rotate-180" : ""} size={19} /></button>
      {showManual && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Input label="City" value={form.city} onChange={(value) => setForm({ ...form, city: value })} /><Input label="State" value={form.state} onChange={(value) => setForm({ ...form, state: value.toUpperCase().slice(0, 2) })} /><Input label="ZIP optional" value={form.zip} onChange={(value) => setForm({ ...form, zip: value.replace(/\D/g, "").slice(0, 5) })} /><NumberInput label="Search radius in miles" value={form.radiusMiles} min={1} max={30} onChange={(value) => setForm({ ...form, radiusMiles: value })} /><NumberInput label="Maximum businesses" value={form.limit} min={1} max={25} onChange={(value) => setForm({ ...form, limit: value })} /><NumberInput label="Minimum rating" value={form.minimumRating} min={0} max={5} step={0.1} onChange={(value) => setForm({ ...form, minimumRating: value })} /><NumberInput label="Minimum reviews" value={form.minimumReviews} min={0} max={10000} onChange={(value) => setForm({ ...form, minimumReviews: value })} /></div><div className="mt-4 flex flex-wrap gap-3"><Check label="Require phone" checked={form.requirePhone} onChange={(checked) => setForm({ ...form, requirePhone: checked })} /><Check label="Require website" checked={form.requireWebsite} onChange={(checked) => setForm({ ...form, requireWebsite: checked })} /><Check label="Require email" checked={form.requireEmail} onChange={(checked) => setForm({ ...form, requireEmail: checked })} /></div><div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><strong>Search summary:</strong> HVAC businesses within {form.radiusMiles} miles of {form.city}, {form.state}{form.zip ? ` near ZIP ${form.zip}` : ""}. Save no more than {form.limit}. Nothing will be contacted.</div>{working && progressStages[progress] && <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-blue-900">{progressStages[progress]}</span><span className="text-sm text-blue-700">{elapsed} seconds</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full bg-blue-600 transition-all" style={{ width: `${((progress + 1) / progressStages.length) * 100}%` }} /></div></div>}<button onClick={manualDiscovery} disabled={working} className="mt-4 min-h-[48px] w-full rounded-lg bg-blue-700 px-5 font-bold text-white disabled:opacity-60">{working ? "Discovery running" : "Start Manual Discovery"}</button>{result && <><div className={`mt-4 rounded-lg p-3 text-sm font-semibold ${result.searchArea?.exactRadiusApplied ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{result.searchArea?.exactRadiusApplied ? `Exact ${result.searchArea.radiusMiles} mile radius applied` : "Coordinate lookup failed. City boundary search was used."}</div><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6"><Metric label="Raw" value={result.pipeline?.discovered || 0} /><Metric label="Clean" value={result.pipeline?.cleaned || 0} /><Metric label="Qualified" value={result.pipeline?.qualified || 0} /><Metric label="New" value={result.pipeline?.newLeads || 0} /><Metric label="Saved" value={result.pipeline?.imported || 0} /><Metric label="Duplicates" value={Math.max(0, (result.pipeline?.qualified || 0) - (result.pipeline?.newLeads || 0))} /></div></>}</div>}
      {notice && <div className="mt-3 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 size={19} />{notice}</div>}{error && <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800"><AlertTriangle size={19} />{error}</div>}
    </div>

    <main className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className={`${selected ? "hidden lg:block" : "block"} rounded-xl border border-slate-200 bg-white shadow-sm`}><div className="border-b border-slate-200 p-3"><div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search research leads" className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div><div className="mt-2 text-xs font-semibold text-slate-500">{filtered.length} businesses waiting</div></div><div className="max-h-[calc(100vh-240px)] overflow-y-auto p-2">{loading ? <p className="p-4 text-sm text-slate-500">Loading research...</p> : filtered.length === 0 ? <p className="p-4 text-sm text-slate-500">No businesses waiting for research</p> : filtered.map((lead) => <button key={lead.id} onClick={() => { setSelectedId(lead.id); setTab("facts"); if (walkthrough) setWalkStep(3); }} className={`mb-2 w-full rounded-lg border p-3 text-left ${lead.id === selectedId ? "border-blue-500 bg-blue-50" : "border-transparent bg-slate-50 hover:border-slate-300"}`}><div className="flex items-start justify-between gap-2"><div className="font-semibold">{lead.business_name}</div>{lead.ai_summary?.lead_score != null && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{lead.ai_summary.lead_score}</span>}</div><div className="mt-1 text-sm text-slate-600">{[lead.city, lead.state].filter(Boolean).join(", ") || "Location not recorded"}</div><div className="mt-2 text-xs font-semibold text-slate-500">{clean(lead.status)}</div></button>)}</div></aside>

      {!selected ? <section className="hidden min-h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 lg:flex"><div><Sparkles className="mx-auto mb-3" size={44} /><div className="font-semibold">Select a business to begin research</div></div></section> : <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold sm:text-2xl">{selected.business_name}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{clean(selected.status)}</span>{selected.ai_summary?.lead_score != null && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Score {selected.ai_summary.lead_score}</span>}</div><div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600"><span className="flex items-center gap-1"><MapPin size={15} />{[selected.city, selected.state].filter(Boolean).join(", ") || "Location not recorded"}</span>{selected.phone && <span className="flex items-center gap-1"><Phone size={15} />{selected.phone}</span>}{selected.email && <span className="flex items-center gap-1"><Mail size={15} />{selected.email}</span>}</div></div><button onClick={() => setSelectedId(null)} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-100 lg:hidden"><X size={20} /></button></div><div className="mt-4 grid grid-cols-3 rounded-lg bg-slate-100 p-1">{(["facts", "weaknesses", "sources"] as Tab[]).map((item) => <button key={item} onClick={() => { setTab(item); if (walkthrough && item === "sources") setWalkStep(4); }} className={`min-h-[40px] rounded-md text-sm font-semibold capitalize ${tab === item ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>{item}</button>)}</div></div>
        <div className="min-h-[430px] p-4 sm:p-5">{tab === "facts" && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Fact label="Owner" value={selected.owner_name || selected.contact_name} /><Fact label="Industry" value={selected.industry || selected.niche} /><Fact label="Address" value={[selected.address, selected.city, selected.state, selected.postal_code].filter(Boolean).join(", ")} /><Fact label="Current software" value={selected.current_software} /><Fact label="Technologies" value={selected.technologies} /><Fact label="Estimated monthly spend" value={selected.monthly_spend_estimate} /><Fact label="Google rating" value={selected.google_rating} /><Fact label="Google reviews" value={selected.google_review_count} /><Fact label="AI confidence" value={selected.ai_summary?.confidence_level} /></div>{selected.short_description && <Block title="Verified company profile" text={selected.short_description} color="slate" />}</div>}{tab === "weaknesses" && <div className="space-y-4">{!selected.ai_summary ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Run AI Research to generate the weakness report.</div> : <><Block title="AI analysis: main weakness" text={selected.ai_summary.main_pain_point || "No weakness identified"} color="red" /><Block title="AI analysis: why it matters" text={selected.ai_summary.pain_reason || "Needs confirmation"} color="amber" /><Block title="Recommended talking angle" text={selected.ai_summary.best_attack_angle || "Needs confirmation"} color="blue" /><Block title="Suggested opening message" text={selected.ai_summary.recommended_first_message || "Needs confirmation"} color="emerald" /><div className="rounded-lg bg-slate-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Questions to confirm</div>{selected.ai_summary.missing_data_needed?.length ? <ul className="mt-2 space-y-2 text-sm text-slate-700">{selected.ai_summary.missing_data_needed.map((item) => <li key={item}>• {clean(item)}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No missing items reported</p>}</div></>}</div>}{tab === "sources" && <div><div className="mb-4 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><ShieldCheck className="shrink-0" size={19} />Open every source and verify the findings before using them in outreach.</div>{selected.sources.length === 0 ? <p className="text-sm text-slate-500">No source links recorded</p> : <div className="space-y-3">{selected.sources.map((source) => <a key={`${source.label}${source.url}`} href={url(source.url)} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50"><span>{clean(source.label)}</span><ExternalLink size={18} /></a>)}</div>}</div>}</div>
        <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4 sm:p-5"><button onClick={() => leadAction("research")} disabled={working} className="mb-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-5 font-bold text-white disabled:opacity-60"><Sparkles size={18} />{working ? "Research running" : selected.ai_summary ? "Research Again" : "Run AI Research"}</button><div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><button onClick={() => leadAction("approve_email")} disabled={working} className="min-h-[46px] rounded-lg bg-emerald-600 px-2 text-xs font-bold text-white">Approve for Email</button><button onClick={() => leadAction("move_calls")} disabled={working} className="min-h-[46px] rounded-lg bg-blue-700 px-2 text-xs font-bold text-white">Move to Calls</button><button onClick={() => leadAction("needs_more")} disabled={working} className="min-h-[46px] rounded-lg bg-amber-100 px-2 text-xs font-bold text-amber-800">Needs More Research</button><button onClick={() => leadAction("reject")} disabled={working} className="min-h-[46px] rounded-lg bg-slate-200 px-2 text-xs font-bold text-slate-700">Reject Lead</button><button onClick={() => leadAction("do_not_contact")} disabled={working} className="col-span-2 min-h-[46px] rounded-lg bg-red-100 px-2 text-xs font-bold text-red-800 sm:col-span-1">Do Not Contact</button></div></div>
      </section>}
    </main>
  </div>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-sm font-semibold text-slate-700">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-blue-500" /></label>; }
function NumberInput({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) { return <label className="text-sm font-semibold text-slate-700">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-blue-500" /></label>; }
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-semibold"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" />{label}</label>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-lg font-bold">{value}</div><div className="text-xs text-slate-500">{label}</div></div>; }
function Fact({ label, value }: { label: string; value?: string | number | null }) { return <div className="rounded-lg bg-slate-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Verified: {label}</div><div className="mt-1 text-sm font-medium">{value || "Not recorded"}</div></div>; }
function Block({ title, text, color }: { title: string; text: string; color: "slate" | "red" | "amber" | "blue" | "emerald" }) { const colors = { slate: "bg-slate-50 text-slate-800", red: "bg-red-50 text-red-900", amber: "bg-amber-50 text-amber-900", blue: "bg-blue-50 text-blue-900", emerald: "bg-emerald-50 text-emerald-900" }; return <div className={`rounded-lg p-4 ${colors[color]}`}><div className="text-xs font-bold uppercase tracking-wide opacity-70">{title}</div><p className="mt-2 text-sm leading-7">{text}</p></div>; }
