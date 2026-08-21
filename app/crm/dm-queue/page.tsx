"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FlaskConical, Mail, MapPin, Phone, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import ManualDiscoveryPanel from "../_components/ManualDiscoveryPanel";

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
interface ResearchFact {
  field_name: string; label: string; value?: string | null;
  certainty: "verified" | "single_source" | "ai_inference" | "not_found";
  source_label?: string | null; source_url?: string | null;
  source_count: number; researched_at: string;
}
interface Lead {
  id: string; business_name: string; owner_name?: string; contact_name?: string;
  phone?: string; email?: string; website?: string; address?: string; city?: string;
  state?: string; postal_code?: string; niche?: string; industry?: string; status: string;
  short_description?: string; technologies?: string; current_software?: string;
  monthly_spend_estimate?: string; google_rating?: number; google_review_count?: number;
  ai_summary?: Summary | null; sources: Source[]; research_facts: ResearchFact[];
  evidence_storage_ready?: boolean;
}
type Tab = "facts" | "weaknesses" | "sources";

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
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [researchReviewed, setResearchReviewed] = useState(false);

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
  useEffect(() => { setResearchReviewed(false); }, [selectedId]);

  async function leadAction(action: "research" | "approve_email" | "move_calls" | "needs_more" | "reject" | "do_not_contact") {
    if (!selected) return;
    if (["reject", "do_not_contact"].includes(action) && !window.confirm(`Apply this decision to ${selected.business_name}?`)) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/crm/research-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: selected.id, action, researchReviewed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Research action failed");
      setNotice(action === "research" ? `AI research completed for ${selected.business_name}` : `${selected.business_name} moved successfully`);
      if (data.warning) setError(data.warning);
      if (walkthrough && action === "research") setWalkStep(4);
      setSelectedId(action === "research" ? selected.id : null);
      await loadLeads();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Research action failed"); }
    finally { setWorking(false); }
  }

  return <div className="min-h-screen bg-gray-100 text-gray-900">
    <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3"><div className="flex items-center gap-3"><button onClick={() => router.back()} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-gray-100" aria-label="Go back"><ArrowLeft size={20} /></button><div><h1 className="text-xl font-bold sm:text-2xl">Research Center</h1><p className="text-sm text-gray-500">Find weaknesses, verify sources, then choose the next step</p></div></div><button onClick={() => { setWalkthrough(!walkthrough); setWalkStep(0); setShowManual(true); }} className={`hidden min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex ${walkthrough ? "bg-brand text-white" : "bg-brand-light text-brand-dark"}`}><FlaskConical size={18} />Walkthrough</button></div></header>

    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      {walkthrough && <div className="rounded-xl border border-brand/20 bg-brand-light p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-dark">Walkthrough step {walkStep + 1} of {walkSteps.length}</div><div className="mt-1 font-semibold text-brand-dark">{walkSteps[walkStep]}</div></div><button onClick={() => setWalkthrough(false)} className="rounded-lg p-2 text-brand-dark"><X size={19} /></button></div><div className="mt-3 grid grid-cols-6 gap-1">{walkSteps.map((_, index) => <div key={index} className={`h-2 rounded-full ${index <= walkStep ? "bg-brand" : "bg-brand"}`} />)}</div></div>}
      <div className="mt-4">
        <ManualDiscoveryPanel
          open={showManual}
          onOpenChange={setShowManual}
          onStart={() => { if (walkthrough) setWalkStep(1); }}
          onComplete={async (data) => {
            setError("");
            setNotice(`Discovery finished. ${data.pipeline?.imported || 0} new businesses saved.`);
            await loadLeads();
            if (walkthrough) setWalkStep(2);
          }}
          onError={(message) => { setNotice(""); setError(message); }}
        />
      </div>
      {notice && <div className="mt-3 flex gap-2 rounded-lg border border-brand/20 bg-brand-light p-3 text-sm font-medium text-brand-dark"><CheckCircle2 size={19} />{notice}</div>}{error && <div className="mt-3 flex gap-2 rounded-lg border border-status-lost/20 bg-status-lost/10 p-3 text-sm font-medium text-status-lost"><AlertTriangle size={19} />{error}</div>}
    </div>

    <main className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className={`${selected ? "hidden lg:block" : "block"} rounded-xl border border-gray-200 bg-white shadow-sm`}><div className="border-b border-gray-200 p-3"><div className="relative"><Search className="absolute left-3 top-3 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search research leads" className="min-h-[44px] w-full rounded-lg border border-gray-300 pl-10 pr-3 text-sm outline-none focus:border-brand/20" /></div><div className="mt-2 text-xs font-semibold text-gray-500">{filtered.length} businesses waiting</div></div><div className="max-h-[calc(100vh-240px)] overflow-y-auto p-2">{loading ? <p className="p-4 text-sm text-gray-500">Loading research...</p> : filtered.length === 0 ? <p className="p-4 text-sm text-gray-500">No businesses waiting for research</p> : filtered.map((lead) => <button key={lead.id} onClick={() => { setSelectedId(lead.id); setTab("facts"); if (walkthrough) setWalkStep(3); }} className={`mb-2 w-full rounded-lg border p-3 text-left ${lead.id === selectedId ? "border-brand/20 bg-brand-light" : "border-transparent bg-gray-50 hover:border-gray-300"}`}><div className="flex items-start justify-between gap-2"><div className="font-semibold">{lead.business_name}</div>{lead.ai_summary?.lead_score != null && <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-bold text-brand-dark">{lead.ai_summary.lead_score}</span>}</div><div className="mt-1 text-sm text-gray-600">{[lead.city, lead.state].filter(Boolean).join(", ") || "Location not recorded"}</div><div className="mt-2 text-xs font-semibold text-gray-500">{clean(lead.status)}</div></button>)}</div></aside>

      {!selected ? <section className="hidden min-h-[520px] items-center justify-center rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 lg:flex"><div><Sparkles className="mx-auto mb-3" size={44} /><div className="font-semibold">Select a business to begin research</div></div></section> : <section className="min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-200 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold sm:text-2xl">{selected.business_name}</h2><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold">{clean(selected.status)}</span>{selected.ai_summary?.lead_score != null && <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand-dark">Score {selected.ai_summary.lead_score}</span>}</div><div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-600"><span className="flex items-center gap-1"><MapPin size={15} />{[selected.city, selected.state].filter(Boolean).join(", ") || "Location not recorded"}</span>{selected.phone && <span className="flex items-center gap-1"><Phone size={15} />{selected.phone}</span>}{selected.email && <span className="flex items-center gap-1"><Mail size={15} />{selected.email}</span>}</div></div><button onClick={() => setSelectedId(null)} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-gray-100 lg:hidden"><X size={20} /></button></div><div className="mt-4 grid grid-cols-3 rounded-lg bg-gray-100 p-1">{(["facts", "weaknesses", "sources"] as Tab[]).map((item) => <button key={item} onClick={() => { setTab(item); if (walkthrough && item === "sources") setWalkStep(4); }} className={`min-h-[40px] rounded-md text-sm font-semibold capitalize ${tab === item ? "bg-white text-brand-dark shadow-sm" : "text-gray-600"}`}>{item}</button>)}</div></div>
        <div className="min-h-[430px] p-4 sm:p-5">{tab === "facts" && <div className="space-y-5">{selected.evidence_storage_ready === false && <div className="rounded-lg border border-status-warm/20 bg-status-warm/10 p-4 text-sm font-semibold text-status-warm">Evidence storage needs database migration 010. Current labels are conservative estimates until it is applied.</div>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{selected.research_facts.map((fact) => <Fact key={fact.field_name} fact={fact} />)}<div className="rounded-lg border border-brand/20 bg-brand-light p-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-dark">AI analysis confidence</div><div className="mt-2 text-sm font-semibold capitalize text-brand-dark">{selected.ai_summary?.confidence_level || "Not analyzed"}</div><div className="mt-2 text-xs text-brand-dark">This measures the AI analysis. It is not a verified company fact.</div></div></div></div>}{tab === "weaknesses" && <div className="space-y-4">{!selected.ai_summary ? <div className="rounded-lg border border-status-warm/20 bg-status-warm/10 p-4 text-sm text-status-warm">Run AI Research to generate the weakness report.</div> : <><Block title="AI inference: main weakness" text={selected.ai_summary.main_pain_point || "No weakness identified"} color="red" /><Block title="AI inference: why it matters" text={selected.ai_summary.pain_reason || "Needs confirmation"} color="amber" /><Block title="Recommended talking angle" text={selected.ai_summary.best_attack_angle || "Needs confirmation"} color="blue" /><Block title="Suggested opening message" text={selected.ai_summary.recommended_first_message || "Needs confirmation"} color="emerald" /><div className="rounded-lg bg-gray-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-gray-500">Questions to confirm</div>{selected.ai_summary.missing_data_needed?.length ? <ul className="mt-2 space-y-2 text-sm text-gray-700">{selected.ai_summary.missing_data_needed.map((item) => <li key={item}>• {clean(item)}</li>)}</ul> : <p className="mt-2 text-sm text-gray-600">No missing items reported</p>}</div></>}</div>}{tab === "sources" && <div><div className="mb-4 flex gap-2 rounded-lg border border-brand/20 bg-brand-light p-3 text-sm text-brand-dark"><ShieldCheck className="shrink-0" size={19} />Open every source and verify the findings before using them in outreach.</div>{selected.sources.length === 0 ? <p className="text-sm text-gray-500">No source links recorded</p> : <div className="space-y-3">{selected.sources.map((source) => <a key={`${source.label}${source.url}`} href={url(source.url)} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-brand-dark hover:bg-brand-light"><span>{clean(source.label)}</span><ExternalLink size={18} /></a>)}</div>}<label className="mt-5 flex min-h-[52px] items-center gap-3 rounded-lg border border-brand/20 bg-brand-light p-4 text-sm font-semibold text-brand-dark"><input type="checkbox" checked={researchReviewed} onChange={(event) => setResearchReviewed(event.target.checked)} className="h-5 w-5" />I checked the available sources and understand which facts still need confirmation.</label></div>}</div>
        <div className="sticky bottom-0 border-t border-gray-200 bg-white p-4 sm:p-5"><button onClick={() => leadAction("research")} disabled={working} className="mb-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 font-bold text-white disabled:opacity-60"><Sparkles size={18} />{working ? "Research running" : selected.ai_summary ? "Research Again" : "Run AI Research"}</button><div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><button onClick={() => leadAction("approve_email")} disabled={working || selected.ai_summary?.confidence_level === "low" && !researchReviewed} className="min-h-[46px] rounded-lg bg-brand px-2 text-xs font-bold text-white disabled:opacity-40">Approve for Email</button><button onClick={() => leadAction("move_calls")} disabled={working} className="min-h-[46px] rounded-lg bg-brand px-2 text-xs font-bold text-white">Move to Calls</button><button onClick={() => leadAction("needs_more")} disabled={working} className="min-h-[46px] rounded-lg bg-status-warm/10 px-2 text-xs font-bold text-status-warm">Needs More Research</button><button onClick={() => leadAction("reject")} disabled={working} className="min-h-[46px] rounded-lg bg-gray-200 px-2 text-xs font-bold text-gray-700">Reject Lead</button><button onClick={() => leadAction("do_not_contact")} disabled={working} className="col-span-2 min-h-[46px] rounded-lg bg-status-lost/10 px-2 text-xs font-bold text-status-lost sm:col-span-1">Do Not Contact</button></div></div>
      </section>}
    </main>
  </div>;
}

function Fact({ fact }: { fact: ResearchFact }) {
  const styles = { verified: "border-brand/20 bg-brand-light text-brand-dark", single_source: "border-brand/20 bg-brand-light text-brand-dark", ai_inference: "border-brand/20 bg-brand-light text-brand-dark", not_found: "border-gray-200 bg-gray-50 text-gray-600" };
  const labels = { verified: "Verified", single_source: "Single source", ai_inference: "AI inference", not_found: "Not found" };
  return <div className={`rounded-lg border p-4 ${styles[fact.certainty]}`}><div className="text-xs font-bold uppercase tracking-wide">{labels[fact.certainty]}</div><div className="mt-1 text-xs font-semibold opacity-75">{fact.label}</div><div className="mt-2 break-words text-sm font-semibold">{fact.value || "No reliable value found"}</div>{fact.source_label && <div className="mt-3 text-xs opacity-80">Source: {fact.source_label}</div>}{fact.source_url && <a href={url(fact.source_url)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold underline">Open source <ExternalLink size={13} /></a>}</div>;
}
function Block({ title, text, color }: { title: string; text: string; color: "slate" | "red" | "amber" | "blue" | "emerald" }) { const colors = { slate: "bg-gray-50 text-gray-800", red: "bg-status-lost/10 text-status-lost", amber: "bg-status-warm/10 text-status-warm", blue: "bg-brand-light text-brand-dark", emerald: "bg-brand-light text-brand-dark" }; return <div className={`rounded-lg p-4 ${colors[color]}`}><div className="text-xs font-bold uppercase tracking-wide opacity-70">{title}</div><p className="mt-2 text-sm leading-7">{text}</p></div>; }
