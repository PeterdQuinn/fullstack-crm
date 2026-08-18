"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, ExternalLink, Mail, MapPin, Phone, Search, Star, UserRound } from "lucide-react";
import { CALL_OUTCOMES, type CallOutcome } from "@/lib/types";

interface AISummary {
  lead_score?: number;
  confidence_level?: string;
  main_pain_point?: string;
  pain_reason?: string;
  best_attack_angle?: string;
  recommended_first_message?: string;
  recommended_follow_up?: string;
}

interface CallHistory {
  id: string;
  called_at: string;
  outcome: string;
  notes?: string;
}

interface LeadNote {
  id: string;
  note: string;
  created_at: string;
}

interface Lead {
  id: string;
  business_name: string;
  owner_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  niche?: string;
  industry?: string;
  status: string;
  short_description?: string;
  employees?: string;
  annual_revenue?: string;
  founded_year?: string;
  current_software?: string;
  monthly_spend_estimate?: string;
  pain_point?: string;
  google_rating?: number;
  google_review_count?: number;
  last_called_at?: string;
  next_follow_up_at?: string;
  ai_summary?: AISummary | null;
  call_logs?: CallHistory[];
  lead_notes?: LeadNote[];
}

function displayDate(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function displayStatus(value: string) {
  return value.replaceAll("-", " ");
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value || "Not recorded"}</div>
    </div>
  );
}

export default function CallQueuePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome>("No answer");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchQueue() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/crm/call-queue", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load calls");
      setLeads(data);
      setSelectedId((current) => current && data.some((lead: Lead) => lead.id === current) ? current : data[0]?.id || null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchQueue(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) => [lead.business_name, lead.owner_name, lead.contact_name, lead.city, lead.phone]
      .some((value) => value?.toLowerCase().includes(term)));
  }, [leads, search]);

  const selected = leads.find((lead) => lead.id === selectedId) || null;

  async function saveCall() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/crm/log-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selected.id,
          outcome,
          notes,
          followUpAt: followUp ? new Date(`${followUp}T09:00:00`).toISOString() : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the call");
      setNotes("");
      setFollowUp("");
      setOutcome("No answer");
      await fetchQueue();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save the call");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-100 text-slate-700" aria-label="Go back"><ArrowLeft size={20} /></button>
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">Call Workspace</h1>
              <p className="text-sm text-slate-500">Everything you need before you dial</p>
            </div>
          </div>
          <div className="rounded-lg bg-blue-50 px-4 py-2 text-center">
            <div className="text-xl font-bold text-blue-700">{leads.length}</div>
            <div className="text-xs font-medium text-blue-700">Calls ready</div>
          </div>
        </div>
      </header>

      {error && <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6"><div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div></div>}

      <main className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 text-slate-400" size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search calls" className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="max-h-[calc(100vh-190px)] overflow-y-auto p-2">
            {loading ? <p className="p-4 text-sm text-slate-500">Loading call information...</p> : filtered.length === 0 ? <p className="p-4 text-sm text-slate-500">No calls match this search</p> : filtered.map((lead) => {
              const active = lead.id === selectedId;
              const name = lead.owner_name || lead.contact_name || "Owner not recorded";
              return (
                <button key={lead.id} onClick={() => setSelectedId(lead.id)} className={`mb-2 w-full rounded-lg border p-3 text-left transition ${active ? "border-blue-500 bg-blue-50" : "border-transparent bg-slate-50 hover:border-slate-300"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-900">{lead.business_name}</div>
                    {lead.ai_summary?.lead_score != null && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{lead.ai_summary.lead_score}</span>}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{name}</div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{[lead.city, lead.state].filter(Boolean).join(", ") || "Location not recorded"}</span>
                    <span className="rounded-full bg-white px-2 py-1">{displayStatus(lead.status)}</span>
                  </div>
                  {lead.next_follow_up_at && <div className="mt-2 text-xs font-medium text-amber-700">Follow up {displayDate(lead.next_follow_up_at)}</div>}
                </button>
              );
            })}
          </div>
        </aside>

        {!selected ? (
          <section className="flex min-h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Select a lead to prepare for the call</section>
        ) : (
          <section className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold">{selected.business_name}</h2>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{displayStatus(selected.status)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                    <span className="flex items-center gap-2"><UserRound size={16} />{selected.owner_name || selected.contact_name || "Owner not recorded"}</span>
                    <span className="flex items-center gap-2"><MapPin size={16} />{[selected.address, selected.city, selected.state, selected.postal_code].filter(Boolean).join(", ") || "Address not recorded"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.phone && <a href={`tel:${selected.phone}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700"><Phone size={19} />Call {selected.phone}</a>}
                  {selected.email && <a href={`mailto:${selected.email}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-slate-700 px-4 py-3 font-semibold text-white"><Mail size={18} />Email</a>}
                  {selected.website && <a href={selected.website.startsWith("http") ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white"><ExternalLink size={18} />Website</a>}
                </div>
              </div>
              {selected.short_description && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{selected.short_description}</p>}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Industry" value={selected.industry || selected.niche} />
                <Field label="Employees" value={selected.employees} />
                <Field label="Annual revenue" value={selected.annual_revenue} />
                <Field label="Founded" value={selected.founded_year} />
                <Field label="Current software" value={selected.current_software} />
                <Field label="Monthly software spend" value={selected.monthly_spend_estimate} />
                <Field label="Last called" value={displayDate(selected.last_called_at)} />
                <Field label="Next follow up" value={displayDate(selected.next_follow_up_at)} />
              </div>
              {(selected.google_rating || selected.google_review_count) && <div className="mt-4 flex items-center gap-2 text-sm font-medium text-amber-700"><Star size={17} fill="currentColor" />Google rating {selected.google_rating || "Not recorded"} from {selected.google_review_count || 0} reviews</div>}
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between"><h3 className="font-bold">Call Preparation</h3>{selected.ai_summary?.lead_score != null && <span className="rounded-lg bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">Score {selected.ai_summary.lead_score}</span>}</div>
                <div className="space-y-4">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Main pain point</div><p className="mt-1 text-sm leading-6">{selected.ai_summary?.main_pain_point || selected.pain_point || "Ask what slows down scheduling, dispatch, estimates, invoicing, or follow through."}</p></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Best talking angle</div><p className="mt-1 text-sm leading-6">{selected.ai_summary?.best_attack_angle || "Focus on replacing recurring software costs with a system they own."}</p></div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Suggested opener</div><p className="mt-2 text-sm font-medium leading-6 text-blue-950">{selected.ai_summary?.recommended_first_message || `Hi, this is Peter with Full Stack Services. I was looking at ${selected.business_name} and wanted to ask how you currently handle scheduling and daily operations.`}</p></div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-bold">Record This Call</h3>
                <label className="text-sm font-semibold text-slate-700">Outcome</label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                  {CALL_OUTCOMES.map((item) => <button key={item} onClick={() => setOutcome(item)} className={`min-h-[44px] rounded-lg border px-2 py-2 text-xs font-semibold ${outcome === item ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{item}</button>)}
                </div>
                <label className="mt-4 block text-sm font-semibold text-slate-700">Call notes</label>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Who answered, what they said, their software, pain points, and next step" className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500" />
                <label className="mt-4 block text-sm font-semibold text-slate-700">Follow up date</label>
                <input type="date" value={followUp} onChange={(event) => setFollowUp(event.target.value)} className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500" />
                <button onClick={saveCall} disabled={saving} className="mt-4 min-h-[48px] w-full rounded-lg bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-60">{saving ? "Saving call..." : "Save call and update lead"}</button>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 font-bold"><Phone size={18} />Recent Calls</h3>
                {!selected.call_logs?.length ? <p className="text-sm text-slate-500">No previous calls recorded</p> : <div className="space-y-3">{selected.call_logs.map((call) => <div key={call.id} className="rounded-lg bg-slate-50 p-3"><div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{call.outcome}</span><span className="text-slate-500">{displayDate(call.called_at)}</span></div>{call.notes && <p className="mt-2 text-sm leading-6 text-slate-700">{call.notes}</p>}</div>)}</div>}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 font-bold"><Building2 size={18} />Lead Notes</h3>
                {!selected.lead_notes?.length ? <p className="text-sm text-slate-500">No notes recorded</p> : <div className="space-y-3">{selected.lead_notes.map((note) => <div key={note.id} className="rounded-lg bg-slate-50 p-3"><p className="text-sm leading-6 text-slate-700">{note.note}</p><div className="mt-2 flex items-center gap-1 text-xs text-slate-500"><CalendarClock size={14} />{displayDate(note.created_at)}</div></div>)}</div>}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
