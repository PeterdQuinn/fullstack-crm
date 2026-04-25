"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Lead, LeadStatus, CallOutcome, CallLog, LeadNote, Appointment,
  LEAD_STATUSES, CALL_OUTCOMES, STATUS_COLORS, GUIDED_QUESTIONS, POSITIONING_LINES,
} from "@/lib/types";
import { PRELOADED_LEADS } from "@/lib/leads-data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const COMPANY_PHONE = "(602) 845-9242";
const COMPANY_PHONE_RAW = "+16028459242";
const COMPANY_EMAIL = "sales@fullstackservicesllc.net";
const CALENDLY_LINK = "https://calendly.com/fullstackservicesllc/30min";

const GATEKEEPER_SCRIPTS = [
  {
    situation: "Opening — owner name known",
    line: "Hey, is [Owner Name] in?",
  },
  {
    situation: "Opening — owner name unknown",
    line: "Hey, who's the owner over there? Can you connect me with them real quick?",
  },
  {
    situation: '"What\'s it about?"',
    line: "It's about their current booking system — it'll take 60 seconds.",
  },
  {
    situation: '"Can I take a message?"',
    line: "I'd rather catch them directly — when's a good window today or tomorrow?",
  },
  {
    situation: '"They\'re not available"',
    line: "No problem — is there a direct number I can reach them on, or a better time to call back?",
  },
  {
    situation: '"Who are you with?"',
    line: "Full Stack Services — we work with [niche] businesses in the area on their scheduling software.",
  },
  {
    situation: "They keep blocking — go around",
    line: "Try calling before 8:30am or after 5pm — owner usually picks up directly.",
  },
];

const TIE_DOWN_LINES = [
  "So you're using [X] right now — that's what you rely on daily, correct?",
  "So you're paying that every single month just to keep it running, right?",
  "And if you stopped paying, you lose access to everything — that's how it works, correct?",
  "That's been frustrating for a while now, hasn't it?",
  "So you're paying monthly, you don't own it, and it's not doing everything you need — fair to say?",
  "If there was a better way to handle that without being locked into that, you'd at least want to see it, right?",
];

const OBJECTION_REBUTTALS = [
  { objection: "I'm not interested", rebuttal: "Totally — quick question, are you not interested because everything's perfect, or you just haven't looked at other options yet?" },
  { objection: "We're good with what we have", rebuttal: "Yeah, most people say that at first — until they look at what they've paid over the last year. You're still paying monthly on that, right?" },
  { objection: "It's too expensive", rebuttal: "Compared to what you're already paying monthly, or just in general? You're already spending on this — we're just talking about owning it instead of renting it." },
  { objection: "Send me info", rebuttal: "I can send something over — it just won't make much sense without seeing it. Let's lock in a quick 10 minutes and I'll send it right after." },
  { objection: "I'm busy", rebuttal: "Yeah I figured — that's why I said quick. This is literally just to see if it even makes sense or not." },
  { objection: "Call me later", rebuttal: "Yeah no problem — what's better for you, later today or tomorrow morning?" },
  { objection: "We don't have budget", rebuttal: "Totally — that's actually why most people take the call. They're already spending monthly, they just don't realize how much over time." },
  { objection: "Gatekeeper blocks you", rebuttal: "Yeah I totally get it — just let them know it's about their current booking system and what they're paying for it. It'll make sense." },
];

function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function dedupKey(l: { business_name: string; phone?: string }) {
  return `${l.business_name.toLowerCase().trim()}|${(l.phone || "").replace(/\D/g, "")}`;
}
function fmt(d?: string) { if (!d) return "—"; return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtTime(d?: string) { if (!d) return ""; return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function isToday(d?: string) { if (!d) return false; return new Date(d).toDateString() === new Date().toDateString(); }
function isThisWeek(d?: string) { if (!d) return false; const t = new Date(d), now = new Date(); const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(start.getDate() + 7); return t >= start && t < end; }
function isPast(d?: string) { if (!d) return false; return new Date(d) < new Date(); }

export default function CRMDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [nicheFilter, setNicheFilter] = useState<string>("all");
  const [showImport, setShowImport] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showScript, setShowScript] = useState(true);
  const [showPositioning, setShowPositioning] = useState(true);
  const [showTieDowns, setShowTieDowns] = useState(true);
  const [showObjections, setShowObjections] = useState(true);
  const [tab, setTab] = useState<"details" | "calls" | "notes" | "meeting">("details");
  const [dbMode, setDbMode] = useState<"local" | "supabase">("local");
  const [showDialer, setShowDialer] = useState(false);

  useEffect(() => {
    async function init() {
      if (isSupabaseConfigured()) {
        setDbMode("supabase");
        const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
        const existing = (data || []) as Lead[];

        // Sync any PRELOADED_LEADS not yet in Supabase
        const existingKeys = new Set(existing.map(dedupKey));
        const missing = PRELOADED_LEADS
          .map((l) => ({ ...l, id: uid(), created_at: now(), updated_at: now() } as Lead))
          .filter((l) => !existingKeys.has(dedupKey(l)));
        if (missing.length > 0) {
          await supabase.from("leads").insert(missing);
        }

        // Auto-dedup on load
        const allLeads = [...missing, ...existing];
        const seenKeys = new Set<string>();
        const dupeIds: string[] = [];
        for (const l of [...allLeads].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())) {
          const k = dedupKey(l); if (seenKeys.has(k)) dupeIds.push(l.id); else seenKeys.add(k);
        }
        if (dupeIds.length > 0) await Promise.all(dupeIds.map((id) => supabase.from("leads").delete().eq("id", id)));
        setLeads(allLeads.filter((l) => !dupeIds.includes(l.id)));
      } else {
        setLeads(PRELOADED_LEADS.map((l) => ({ ...l, id: uid(), created_at: now(), updated_at: now() } as Lead)));
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (dbMode === "supabase") {
      supabase.from("call_logs").select("*").eq("lead_id", selectedId).order("called_at", { ascending: false }).then(({ data }: any) => setCallLogs(data || []));
      supabase.from("lead_notes").select("*").eq("lead_id", selectedId).order("created_at", { ascending: false }).then(({ data }: any) => setNotes(data || []));
      supabase.from("appointments").select("*").eq("lead_id", selectedId).order("created_at", { ascending: false }).then(({ data }: any) => setAppointments(data || []));
    } else {
      setCallLogs((prev) => prev.filter((c) => c.lead_id === selectedId));
      setNotes((prev) => prev.filter((n) => n.lead_id === selectedId));
      setAppointments((prev) => prev.filter((a) => a.lead_id === selectedId));
    }
  }, [selectedId, dbMode]);

  const selected = leads.find((l) => l.id === selectedId) || null;

  async function updateLead(id: string, updates: Partial<Lead>) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates, updated_at: now() } : l)));
    if (dbMode === "supabase") { await supabase.from("leads").update({ ...updates, updated_at: now() }).eq("id", id); }
  }

  async function addCallLog(log: Omit<CallLog, "id" | "created_at">) {
    const entry = { ...log, id: uid(), created_at: now() };
    setCallLogs((prev) => [entry, ...prev]);
    // Auto-set follow-up date based on outcome if one wasn't manually set
    const autoFollowUp = (() => {
      if (log.next_follow_up_at) return log.next_follow_up_at;
      const d = new Date();
      if (log.outcome === "No answer" || log.outcome === "Left voicemail") { d.setDate(d.getDate() + 1); return d.toISOString(); }
      if (log.outcome === "Interested" || log.outcome === "Callback requested") { d.setDate(d.getDate() + 2); return d.toISOString(); }
      if (log.outcome === "Spoke with gatekeeper") { d.setDate(d.getDate() + 1); return d.toISOString(); }
      return null;
    })();
    updateLead(log.lead_id, { last_called_at: now(), status: log.outcome === "Booked meeting" ? "Booked" : log.outcome === "Interested" ? "Interested" : log.outcome === "No answer" ? "No Answer" : log.outcome === "Not interested" ? "Dead" : "Called", ...(autoFollowUp ? { next_follow_up_at: autoFollowUp } : {}), ...(log.current_software ? { current_software: log.current_software } : {}) });
    if (dbMode === "supabase") { await supabase.from("call_logs").insert(entry); }
  }

  async function addNote(leadId: string, note: string) {
    const entry = { id: uid(), lead_id: leadId, note, created_at: now() };
    setNotes((prev) => [entry, ...prev]);
    if (dbMode === "supabase") { await supabase.from("lead_notes").insert(entry); }
  }

  async function bookMeeting(leadId: string, date: string, time: string, meetingNotes: string) {
    const entry: Appointment = { id: uid(), lead_id: leadId, meeting_date: date, meeting_time: time, notes: meetingNotes, created_at: now() };
    setAppointments((prev) => [entry, ...prev]);
    updateLead(leadId, { meeting_booked: true, meeting_date: `${date}T${time}`, status: "Booked" });
    if (dbMode === "supabase") { await supabase.from("appointments").insert(entry); }
  }

  async function deleteAll() {
    if (!confirm("Delete ALL leads, call logs, notes, and appointments? This cannot be undone.")) return;
    if (dbMode === "supabase") {
      await supabase.from("call_logs").delete().neq("id", "");
      await supabase.from("lead_notes").delete().neq("id", "");
      await supabase.from("appointments").delete().neq("id", "");
      await supabase.from("leads").delete().neq("id", "");
    }
    setLeads([]); setCallLogs([]); setNotes([]); setAppointments([]); setSelectedId(null);
  }

  async function deduplicateLeads() {
    const seen = new Set<string>();
    const toDelete: string[] = [];
    const sorted = [...leads].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (const lead of sorted) {
      const key = dedupKey(lead);
      if (seen.has(key)) { toDelete.push(lead.id); } else { seen.add(key); }
    }
    if (toDelete.length === 0) { alert("No duplicates found — your leads are clean!"); return; }
    if (!confirm(`Remove ${toDelete.length} duplicate lead(s)? Oldest copy of each will be kept.`)) return;
    setLeads((prev) => prev.filter((l) => !toDelete.includes(l.id)));
    if (dbMode === "supabase") {
      await Promise.all(toDelete.map((id) => supabase.from("leads").delete().eq("id", id)));
    }
    if (selectedId && toDelete.includes(selectedId)) setSelectedId(null);
  }

  async function deleteLead(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setSelectedId(null);
    if (dbMode === "supabase") {
      await supabase.from("call_logs").delete().eq("lead_id", id);
      await supabase.from("lead_notes").delete().eq("lead_id", id);
      await supabase.from("appointments").delete().eq("lead_id", id);
      await supabase.from("leads").delete().eq("id", id);
    }
  }

  async function importLeads(imported: Partial<Lead>[]) {
    const newLeads = imported.map((l) => ({ id: uid(), business_name: l.business_name || "Unknown", owner_name: l.owner_name || "", phone: l.phone || "", email: l.email || "", website: l.website || "", address: l.address || "", city: l.city || "", state: l.state || "", postal_code: l.postal_code || "", niche: l.niche || l.industry || "General", industry: l.industry || "", employees: l.employees || "", annual_revenue: l.annual_revenue || "", founded_year: l.founded_year || "", short_description: l.short_description || "", technologies: l.technologies || "", keywords: l.keywords || "", linkedin_url: l.linkedin_url || "", facebook_url: l.facebook_url || "", twitter_url: l.twitter_url || "", apollo_account_id: l.apollo_account_id || "", current_software: l.current_software || "", status: "New" as LeadStatus, meeting_booked: false, created_at: now(), updated_at: now() })) as Lead[];
    const existing = new Set(leads.map(dedupKey));
    const unique = newLeads.filter((l) => !existing.has(dedupKey(l)));
    setLeads((prev) => [...unique, ...prev]);
    if (dbMode === "supabase" && unique.length > 0) { await supabase.from("leads").insert(unique); }
    return unique.length;
  }

  async function addSingleLead(data: Partial<Lead>) {
    const lead: Lead = { id: uid(), business_name: data.business_name || "Unknown", owner_name: data.owner_name || "", phone: data.phone || "", email: data.email || "", website: data.website || "", address: data.address || "", city: data.city || "", state: data.state || "", postal_code: data.postal_code || "", niche: data.niche || "General", industry: data.industry || "", employees: data.employees || "", annual_revenue: data.annual_revenue || "", founded_year: data.founded_year || "", short_description: data.short_description || "", technologies: data.technologies || "", keywords: data.keywords || "", linkedin_url: data.linkedin_url || "", facebook_url: data.facebook_url || "", twitter_url: data.twitter_url || "", apollo_account_id: "", current_software: data.current_software || "", monthly_spend_estimate: data.monthly_spend_estimate || "", status: "New", meeting_booked: false, created_at: now(), updated_at: now() };
    setLeads((prev) => [lead, ...prev]);
    if (dbMode === "supabase") { await supabase.from("leads").insert(lead); }
    setSelectedId(lead.id);
  }

  const filtered = useMemo(() => leads.filter((l) => { const s = search === "" || l.business_name.toLowerCase().includes(search.toLowerCase()) || l.owner_name?.toLowerCase().includes(search.toLowerCase()) || l.phone?.includes(search) || l.city?.toLowerCase().includes(search.toLowerCase()); return s && (statusFilter === "all" || l.status === statusFilter) && (nicheFilter === "all" || l.niche === nicheFilter); }), [leads, search, statusFilter, nicheFilter]);

  const kpis = useMemo(() => ({ total: leads.length, new: leads.filter((l) => l.status === "New").length, calledToday: leads.filter((l) => isToday(l.last_called_at)).length, calledThisWeek: leads.filter((l) => isThisWeek(l.last_called_at)).length, followUps: leads.filter((l) => l.next_follow_up_at && isPast(l.next_follow_up_at) && l.status !== "Booked" && l.status !== "Dead").length, booked: leads.filter((l) => l.status === "Booked").length, interested: leads.filter((l) => l.status === "Interested").length, dead: leads.filter((l) => l.status === "Dead").length }), [leads]);

  const niches = useMemo(() => [...new Set(leads.map((l) => l.niche).filter(Boolean))], [leads]);

  return (
    <div className="h-[100dvh] min-h-0 flex flex-col overflow-hidden bg-gray-50">
      <header className="bg-white border-b px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center flex-shrink-0"><span className="text-white text-sm font-bold">FS</span></div>
          <div className="min-w-0"><h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Full Stack Services CRM</h1><p className="text-xs text-gray-500 truncate">{COMPANY_EMAIL} · {COMPANY_PHONE}</p></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={deduplicateLeads} className="px-3 py-1.5 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 transition-colors">Remove Duplicates</button>
          <button onClick={() => setShowDialer(true)} className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors">⚡ Dial</button>
          <button onClick={() => setShowAddLead(true)} className="px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors">+ Add Lead</button>
          <button onClick={() => setShowImport(true)} className="px-3 py-1.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors">Import CSV</button>
        </div>
      </header>

      <div className="bg-white border-b px-4 sm:px-6 py-3 flex-shrink-0"><div className="flex gap-3 overflow-x-auto pb-1">{[{ label: "Total Leads", value: kpis.total, color: "text-gray-900" },{ label: "New", value: kpis.new, color: "text-blue-600" },{ label: "Called Today", value: kpis.calledToday, color: "text-yellow-600" },{ label: "Called This Week", value: kpis.calledThisWeek, color: "text-orange-500" },{ label: "Follow-Ups Due", value: kpis.followUps, color: "text-purple-600" },{ label: "Booked", value: kpis.booked, color: "text-green-600" },{ label: "Interested", value: kpis.interested, color: "text-emerald-600" },{ label: "Dead", value: kpis.dead, color: "text-red-500" }].map((k) => (<div key={k.label} className="flex-shrink-0 bg-gray-50 rounded-lg px-4 py-2 min-w-[120px]"><div className={`text-xl sm:text-2xl font-bold ${k.color}`}>{k.value}</div><div className="text-xs text-gray-500">{k.label}</div></div>))}</div></div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="lg:hidden h-full min-h-0">
          <LeadListPanel leads={filtered} allLeads={leads} selectedId={selectedId} setSelectedId={setSelectedId} setTab={setTab} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} nicheFilter={nicheFilter} setNicheFilter={setNicheFilter} niches={niches} />
          {selected && (<div className="fixed inset-0 z-40 bg-black/40"><div className="absolute inset-x-0 bottom-0 top-0 bg-white flex flex-col animate-slide-in"><div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"><div className="min-w-0"><div className="text-xs uppercase tracking-wide text-gray-400">Lead Details</div><div className="font-semibold text-gray-900 truncate">{selected.business_name}</div></div><button onClick={() => setSelectedId(null)} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700">Close</button></div><div className="flex-1 min-h-0 overflow-hidden"><LeadDetailPanel lead={selected} callLogs={callLogs} notes={notes} appointments={appointments} tab={tab} setTab={setTab} showScript={showScript} setShowScript={setShowScript} showPositioning={showPositioning} setShowPositioning={setShowPositioning} showTieDowns={showTieDowns} setShowTieDowns={setShowTieDowns} showObjections={showObjections} setShowObjections={setShowObjections} updateLead={updateLead} addCallLog={addCallLog} addNote={addNote} bookMeeting={bookMeeting} deleteLead={deleteLead} onBack={() => setSelectedId(null)} mobile /></div></div></div>)}
        </div>
        <div className="hidden lg:flex h-full min-h-0">
          <div className="w-1/2 xl:w-3/5 border-r bg-white min-h-0"><LeadListPanel leads={filtered} allLeads={leads} selectedId={selectedId} setSelectedId={setSelectedId} setTab={setTab} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} nicheFilter={nicheFilter} setNicheFilter={setNicheFilter} niches={niches} /></div>
          <div className="w-1/2 xl:w-2/5 bg-white min-h-0 flex flex-col">
            {selected ? (<LeadDetailPanel lead={selected} callLogs={callLogs} notes={notes} appointments={appointments} tab={tab} setTab={setTab} showScript={showScript} setShowScript={setShowScript} showPositioning={showPositioning} setShowPositioning={setShowPositioning} showTieDowns={showTieDowns} setShowTieDowns={setShowTieDowns} showObjections={showObjections} setShowObjections={setShowObjections} updateLead={updateLead} addCallLog={addCallLog} addNote={addNote} bookMeeting={bookMeeting} deleteLead={deleteLead} />) : (<div className="flex-1 flex items-center justify-center text-gray-400 p-6"><div className="text-center"><div className="text-5xl mb-4">📞</div><div className="text-lg font-medium">Select a lead to start</div><div className="text-sm mt-1">Click any row on the left</div></div></div>)}
          </div>
        </div>
      </div>
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={importLeads} />}
      {showAddLead && <AddLeadModal onClose={() => setShowAddLead(false)} onAdd={addSingleLead} />}
      {showDialer && <DialerPanel leads={leads} onUpdateLead={updateLead} onAddCallLog={addCallLog} onClose={() => setShowDialer(false)} />}
    </div>
  );
}

function LeadListPanel({ leads, allLeads, selectedId, setSelectedId, setTab, search, setSearch, statusFilter, setStatusFilter, nicheFilter, setNicheFilter, niches }: any) {
  const [view, setView] = useState<"leads" | "followups">("leads");
  const followUps = useMemo(() =>
    (allLeads as Lead[]).filter((l) => l.next_follow_up_at && isPast(l.next_follow_up_at) && l.status !== "Booked" && l.status !== "Dead")
      .sort((a, b) => new Date(a.next_follow_up_at!).getTime() - new Date(b.next_follow_up_at!).getTime()),
    [allLeads]
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-white">
      <div className="px-4 pt-3 pb-0 border-b bg-white flex-shrink-0">
        <div className="flex gap-1 mb-3">
          <button onClick={() => setView("leads")} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === "leads" ? "bg-brand text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>All Leads</button>
          <button onClick={() => setView("followups")} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${view === "followups" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            Follow-Ups {followUps.length > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${view === "followups" ? "bg-white text-purple-600" : "bg-purple-600 text-white"}`}>{followUps.length}</span>}
          </button>
        </div>
        {view === "leads" && <div className="flex flex-col md:flex-row gap-2 pb-3">
          <input type="text" placeholder="Search leads..." value={search} onChange={(e: any) => setSearch(e.target.value)} className="flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:flex md:gap-2">
            <select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm bg-white w-full md:w-auto"><option value="all">All Statuses</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select value={nicheFilter} onChange={(e: any) => setNicheFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm bg-white w-full md:w-auto"><option value="all">All Niches</option>{niches.map((n: string) => <option key={n} value={n}>{n}</option>)}</select>
          </div>
        </div>}
        {view === "followups" && <div className="pb-3 text-xs text-gray-400">{followUps.length} overdue follow-up{followUps.length !== 1 ? "s" : ""} — click a row to open the lead</div>}
      </div>
      {view === "followups" ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {followUps.length === 0 ? (
            <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">✅</div><div className="font-medium">No follow-ups due</div><div className="text-sm mt-1">They'll appear here automatically after you log a call</div></div>
          ) : (
            <div className="divide-y">
              {followUps.map((lead: Lead) => (
                <div key={lead.id} onClick={() => { setSelectedId(lead.id); setTab("calls"); }} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-purple-50 transition-colors ${selectedId === lead.id ? "bg-purple-50 border-l-4 border-l-purple-600" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{lead.business_name}</div>
                    <div className="text-xs text-gray-500 truncate">{lead.owner_name || "—"} · {lead.city || "—"}</div>
                    <div className="text-xs text-red-600 font-medium mt-0.5">Due {fmt(lead.next_follow_up_at)}</div>
                    {lead.current_software && <div className="text-xs text-blue-500">Uses {lead.current_software}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status]}`}>{lead.status}</span>
                    {lead.phone && lead.phone !== "N/A" && (
                      <a href={`https://voice.google.com/u/0/calls?a=nc,${lead.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="px-3 py-1 bg-brand text-white text-xs font-medium rounded-lg hover:bg-brand-dark transition-colors">📞 Call</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto lg:hidden">
            <div className="p-3 space-y-3">
              {leads.length === 0 ? <div className="text-center py-12 text-gray-400">No leads found</div> : leads.map((lead: Lead) => (
                <button key={lead.id} onClick={() => { setSelectedId(lead.id); setTab("details"); }} className={`w-full text-left rounded-xl border p-4 bg-white shadow-sm transition ${selectedId === lead.id ? "border-brand ring-2 ring-brand/20" : "border-gray-200"}`}>
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-semibold text-gray-900 break-words">{lead.business_name}</div><div className="text-sm text-gray-500 mt-0.5">{lead.owner_name || "—"}</div></div><span className={`text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_COLORS[lead.status]}`}>{lead.status}</span></div>
                  <div className="mt-3 grid grid-cols-1 gap-1 text-sm"><div className="text-gray-600">{lead.phone || "No phone"}</div><div className="text-gray-500">{lead.city || "—"}</div>{lead.current_software && <div className="text-xs text-gray-400">Uses {lead.current_software}</div>}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="hidden lg:block flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10"><tr><th className="text-left px-4 py-3 font-medium text-gray-600">Business</th><th className="text-left px-4 py-3 font-medium text-gray-600">Owner</th><th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th><th className="text-left px-4 py-3 font-medium text-gray-600">Status</th><th className="text-left px-4 py-3 font-medium text-gray-600">Follow-Up</th></tr></thead>
              <tbody>
                {leads.map((lead: Lead) => (
                  <tr key={lead.id} onClick={() => { setSelectedId(lead.id); setTab("details"); }} className={`border-b cursor-pointer transition-colors hover:bg-brand/5 ${selectedId === lead.id ? "bg-brand/10 border-l-4 border-l-brand" : ""}`}>
                    <td className="px-4 py-2.5"><div className="font-medium text-gray-900 truncate max-w-[220px]">{lead.business_name}</div>{lead.current_software && <div className="text-xs text-gray-400">Uses {lead.current_software}</div>}</td>
                    <td className="px-4 py-2.5 text-gray-700 truncate max-w-[160px]">{lead.owner_name || "—"}</td>
                    <td className="px-4 py-2.5">{lead.phone && lead.phone !== "N/A" ? <a href={`https://voice.google.com/u/0/calls?a=nc,${lead.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="text-brand font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{lead.phone}</a> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status]}`}>{lead.status}</span></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{lead.next_follow_up_at ? <span className={isPast(lead.next_follow_up_at) ? "text-red-600 font-medium" : ""}>{fmt(lead.next_follow_up_at)}</span> : "—"}</td>
                  </tr>
                ))}
                {leads.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-gray-400">No leads found</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function LeadDetailPanel({ lead, callLogs, notes, appointments, tab, setTab, showScript, setShowScript, showPositioning, setShowPositioning, showTieDowns, setShowTieDowns, showObjections, setShowObjections, updateLead, addCallLog, addNote, bookMeeting, deleteLead, onBack, mobile = false }: { lead: Lead; [key: string]: any }) {
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null);

  async function findPhone() {
    setScraping(true); setScrapeMsg(null);
    try {
      const body = { website: lead.website || undefined, business_name: lead.business_name, city: lead.city || "" };
      const res = await fetch("/api/scrape-phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      const updates: any = {};
      if (data.phone)                               updates.phone = data.phone;
      if (data.owner && !lead.owner_name)           updates.owner_name = data.owner;
      if (data.email && !lead.email)                updates.email = data.email;
      if (data.current_software && !lead.current_software) updates.current_software = data.current_software;
      if (data.facebook_url && !lead.facebook_url)  updates.facebook_url = data.facebook_url;
      if (data.instagram_url && !(lead as any).instagram_url) updates.instagram_url = data.instagram_url;
      if (data.linkedin_url && !lead.linkedin_url)  updates.linkedin_url = data.linkedin_url;
      if (data.technologies && !lead.technologies)  updates.technologies = data.technologies;
      if (data.description && !lead.short_description) updates.short_description = data.description;
      if (data.address && !lead.address)            updates.address = data.address;
      // Always save whatever was found, even partial
      if (Object.keys(updates).length > 0) {
        updateLead(lead.id, updates);
      }
      const found = [
        data.phone   && `Phone: ${data.phone}`,
        data.owner   && `Owner: ${data.owner}`,
        data.email   && `Email: ${data.email}`,
        data.current_software && `Software: ${data.current_software}`,
      ].filter(Boolean);
      if (found.length > 0) {
        setScrapeMsg(`Found — ${found.join(" · ")}`);
      } else if (data.address || data.description || data.facebook_url) {
        setScrapeMsg("Saved partial info — no phone found");
      } else {
        setScrapeMsg("Site blocked or no data found — check website manually");
      }
    } catch { setScrapeMsg("Scrape failed"); }
    setScraping(false);
    setTimeout(() => setScrapeMsg(null), 6000);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{mobile && onBack && <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-brand font-medium">← Back</button>}<h2 className="text-lg font-bold text-gray-900 break-words">{lead.business_name}</h2><p className="text-sm text-gray-500">{lead.owner_name || "No owner"}</p></div>
          <div className="flex items-center gap-2">
            <select value={lead.status} onChange={(e) => updateLead(lead.id, { status: e.target.value as LeadStatus })} className={`text-xs px-2 py-1 rounded-full font-medium border-0 max-w-[140px] ${STATUS_COLORS[lead.status]}`}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button onClick={() => deleteLead(lead.id)} className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors font-medium">Delete</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {lead.phone && lead.phone !== "N/A" && <a href={`https://voice.google.com/u/0/calls?a=nc,${lead.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors">📞 Call</a>}
          {lead.phone && lead.phone !== "N/A" && <a href={`https://voice.google.com/u/0/messages?a=nc,${lead.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors">💬 Text</a>}
          {lead.website && lead.website !== "N/A" && <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors">🌐 Website</a>}
          {lead.linkedin_url && <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">in LinkedIn</a>}
          {(lead as any).instagram_url && <a href={(lead as any).instagram_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-pink-500 text-white text-sm rounded-lg hover:bg-pink-600 transition-colors">IG</a>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={findPhone} disabled={scraping} className="px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors">{scraping ? "Scanning..." : "🔍 Find Phone"}</button>
          {scrapeMsg && <span className={`text-xs font-medium ${scrapeMsg.startsWith("Found") ? "text-green-600" : "text-red-500"}`}>{scrapeMsg}</span>}
        </div>
      </div>
      <div className="border-b px-4 overflow-x-auto flex-shrink-0"><div className="flex min-w-max">{(["details","calls","notes","meeting"] as const).map((t) => (<button key={t} onClick={() => setTab(t)} className={`px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t === "details" ? "Details" : t === "calls" ? "Call Log" : t === "notes" ? "Notes" : "Meeting"}</button>))}</div></div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === "details" && <DetailsTab lead={lead} updateLead={updateLead} showScript={showScript} setShowScript={setShowScript} showPositioning={showPositioning} setShowPositioning={setShowPositioning} showTieDowns={showTieDowns} setShowTieDowns={setShowTieDowns} showObjections={showObjections} setShowObjections={setShowObjections} />}
        {tab === "calls" && <CallsTab lead={lead} callLogs={callLogs} addCallLog={addCallLog} />}
        {tab === "notes" && <NotesTab lead={lead} notes={notes} addNote={addNote} />}
        {tab === "meeting" && <MeetingTab lead={lead} appointments={appointments} bookMeeting={bookMeeting} />}
      </div>
    </div>
  );
}

function DetailsTab({ lead, updateLead, showScript, setShowScript, showPositioning, setShowPositioning, showTieDowns, setShowTieDowns, showObjections, setShowObjections }: any) {
  const [showGatekeeper, setShowGatekeeper] = useState(true);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[{ label: "Phone", value: lead.phone },{ label: "Email", value: lead.email },{ label: "Address", value: lead.address },{ label: "City", value: lead.city },{ label: "State", value: lead.state },{ label: "Zip", value: lead.postal_code },{ label: "Niche / Industry", value: lead.industry || lead.niche },{ label: "Current Software", value: lead.current_software, editable: true, field: "current_software" },{ label: "Monthly Spend", value: lead.monthly_spend_estimate, editable: true, field: "monthly_spend_estimate" },{ label: "Last Called", value: fmt(lead.last_called_at) }].map((item: any) => (
          <div key={item.label} className="min-w-0"><label className="text-xs text-gray-400 uppercase tracking-wide">{item.label}</label>{item.editable ? <input type="text" defaultValue={item.value || ""} onBlur={(e: any) => updateLead(lead.id, { [item.field]: e.target.value })} className="block w-full text-sm text-gray-900 border-b border-gray-200 py-1 focus:outline-none focus:border-brand bg-transparent" placeholder="Enter..." /> : <div className="text-sm text-gray-900 py-1 break-words">{item.value || "—"}</div>}</div>
        ))}
      </div>
      {(lead.short_description || lead.employees || lead.annual_revenue || lead.founded_year || lead.technologies) && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="font-semibold text-sm text-slate-800">Company Profile</div>
          {lead.short_description && <p className="text-sm text-slate-700 leading-relaxed">{lead.short_description}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {lead.employees && <div><div className="text-xs text-gray-400 uppercase tracking-wide">Employees</div><div className="text-sm text-gray-900">{lead.employees}</div></div>}
            {lead.annual_revenue && <div><div className="text-xs text-gray-400 uppercase tracking-wide">Annual Revenue</div><div className="text-sm text-gray-900">{lead.annual_revenue}</div></div>}
            {lead.founded_year && <div><div className="text-xs text-gray-400 uppercase tracking-wide">Founded</div><div className="text-sm text-gray-900">{lead.founded_year}</div></div>}
          </div>
          {lead.technologies && <div><div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Technologies</div><div className="flex flex-wrap gap-1">{lead.technologies.split(",").slice(0,12).map((t: string) => <span key={t} className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">{t.trim()}</span>)}</div></div>}
          {(lead.facebook_url || lead.twitter_url) && <div className="flex gap-3">{lead.facebook_url && <a href={lead.facebook_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Facebook</a>}{lead.twitter_url && <a href={lead.twitter_url} target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline">Twitter / X</a>}</div>}
        </div>
      )}
      <div><label className="text-xs text-gray-400 uppercase tracking-wide">Next Follow-Up</label><input type="date" value={lead.next_follow_up_at ? lead.next_follow_up_at.split("T")[0] : ""} onChange={(e: any) => updateLead(lead.id, { next_follow_up_at: e.target.value ? `${e.target.value}T09:00:00` : undefined })} className="block w-full text-sm border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-brand/30" /></div>

      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4"><button onClick={() => setShowGatekeeper(!showGatekeeper)} className="flex items-center justify-between w-full text-left gap-3"><span className="font-semibold text-orange-900 text-sm">🚪 Gatekeeper Scripts</span><span className="text-orange-600 text-xs flex-shrink-0">{showGatekeeper ? "Hide" : "Show"}</span></button>{showGatekeeper && <div className="mt-3 space-y-2">{GATEKEEPER_SCRIPTS.map((g, i) => <div key={i} className="rounded-lg bg-white/70 border border-orange-100 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-orange-700">{g.situation}</div><div className="text-sm text-orange-900 mt-1 italic">&ldquo;{g.line}&rdquo;</div></div>)}</div>}</div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4"><button onClick={() => setShowScript(!showScript)} className="flex items-center justify-between w-full text-left gap-3"><span className="font-semibold text-amber-900 text-sm">📋 Call Script</span><span className="text-amber-600 text-xs flex-shrink-0">{showScript ? "Hide" : "Show"}</span></button>{showScript && <div className="mt-3 space-y-2">{GUIDED_QUESTIONS.map((q: string, i: number) => <div key={i} className="flex gap-2 text-sm"><span className="text-amber-600 font-bold flex-shrink-0">{i+1}.</span><span className="text-amber-900">{q}</span></div>)}</div>}</div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4"><button onClick={() => setShowPositioning(!showPositioning)} className="flex items-center justify-between w-full text-left gap-3"><span className="font-semibold text-blue-900 text-sm">💬 Positioning Lines</span><span className="text-blue-600 text-xs flex-shrink-0">{showPositioning ? "Hide" : "Show"}</span></button>{showPositioning && <div className="mt-3 space-y-1.5">{POSITIONING_LINES.map((line: string, i: number) => <div key={i} className="text-sm text-blue-800 italic">&ldquo;{line}&rdquo;</div>)}</div>}</div>
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4"><button onClick={() => setShowTieDowns(!showTieDowns)} className="flex items-center justify-between w-full text-left gap-3"><span className="font-semibold text-violet-900 text-sm">🎯 Tie-Downs</span><span className="text-violet-600 text-xs flex-shrink-0">{showTieDowns ? "Hide" : "Show"}</span></button>{showTieDowns && <div className="mt-3 space-y-2">{TIE_DOWN_LINES.map((line: string, i: number) => <div key={i} className="text-sm text-violet-800">&ldquo;{line}&rdquo;</div>)}</div>}</div>
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4"><button onClick={() => setShowObjections(!showObjections)} className="flex items-center justify-between w-full text-left gap-3"><span className="font-semibold text-rose-900 text-sm">🛡️ Objection Rebuttals</span><span className="text-rose-600 text-xs flex-shrink-0">{showObjections ? "Hide" : "Show"}</span></button>{showObjections && <div className="mt-3 space-y-3">{OBJECTION_REBUTTALS.map((item: any, i: number) => <div key={i} className="rounded-lg bg-white/70 border border-rose-100 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-rose-700">{item.objection}</div><div className="text-sm text-rose-900 mt-1">&ldquo;{item.rebuttal}&rdquo;</div></div>)}</div>}</div>
    </div>
  );
}

function CallsTab({ lead, callLogs, addCallLog }: any) {
  const [outcome, setOutcome] = useState<CallOutcome>("No answer");
  const [logNotes, setLogNotes] = useState("");
  const [software, setSoftware] = useState(lead.current_software || "");
  const [acquisition, setAcquisition] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [followUp, setFollowUp] = useState("");
  function handleSubmit() { addCallLog({ lead_id: lead.id, called_at: now(), outcome, notes: logNotes, current_software: software, client_acquisition_method: acquisition, pain_point: painPoint, next_follow_up_at: followUp ? `${followUp}T09:00:00` : undefined }); setLogNotes(""); setAcquisition(""); setPainPoint(""); setFollowUp(""); }
  return (
    <div className="space-y-5">
      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <div className="font-semibold text-sm text-gray-900">Log a Call</div>
        <div><label className="text-xs text-gray-500">Outcome</label><select value={outcome} onChange={(e: any) => setOutcome(e.target.value)} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-white">{CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
        <div><label className="text-xs text-gray-500">Notes</label><textarea value={logNotes} onChange={(e: any) => setLogNotes(e.target.value)} rows={3} placeholder="What happened..." className="block w-full border rounded-lg px-3 py-2 text-sm mt-1 resize-none" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Current Software</label><input value={software} onChange={(e: any) => setSoftware(e.target.value)} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="Jobber, HCP..." /></div><div><label className="text-xs text-gray-500">How They Get Clients</label><input value={acquisition} onChange={(e: any) => setAcquisition(e.target.value)} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="Google, referrals..." /></div></div>
        <div><label className="text-xs text-gray-500">Pain Points</label><input value={painPoint} onChange={(e: any) => setPainPoint(e.target.value)} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="What frustrates them..." /></div>
        <div><label className="text-xs text-gray-500">Follow-Up</label><input type="date" value={followUp} onChange={(e: any) => setFollowUp(e.target.value)} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
        <button onClick={handleSubmit} className="w-full py-2.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors">Save Call Log</button>
      </div>
      <div><div className="font-semibold text-sm text-gray-900 mb-2">Call History</div>{callLogs.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">No calls logged yet</div> : <div className="space-y-2">{callLogs.map((log: CallLog) => <div key={log.id} className="bg-gray-50 rounded-lg p-3"><div className="flex items-start justify-between gap-3"><span className="text-xs font-medium text-gray-900">{log.outcome}</span><span className="text-xs text-gray-400">{fmt(log.called_at)} {fmtTime(log.called_at)}</span></div>{log.notes && <div className="text-sm text-gray-600 mt-1 break-words">{log.notes}</div>}{log.pain_point && <div className="text-xs text-red-600 mt-1">Pain: {log.pain_point}</div>}{log.current_software && <div className="text-xs text-blue-600 mt-1">Software: {log.current_software}</div>}</div>)}</div>}</div>
    </div>
  );
}

function NotesTab({ lead, notes, addNote }: any) {
  const [noteText, setNoteText] = useState("");
  function handleAdd() { if (!noteText.trim()) return; addNote(lead.id, noteText.trim()); setNoteText(""); }
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2"><input value={noteText} onChange={(e: any) => setNoteText(e.target.value)} onKeyDown={(e: any) => e.key === "Enter" && handleAdd()} placeholder="Add a note..." className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" /><button onClick={handleAdd} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors">Add</button></div>
      {notes.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">No notes yet</div> : <div className="space-y-2">{notes.map((n: LeadNote) => <div key={n.id} className="bg-gray-50 rounded-lg p-3"><div className="text-sm text-gray-800 break-words">{n.note}</div><div className="text-xs text-gray-400 mt-1">{fmt(n.created_at)} {fmtTime(n.created_at)}</div></div>)}</div>}
    </div>
  );
}

function MeetingTab({ lead, appointments, bookMeeting }: any) {
  const [copied, setCopied] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [confirmDate, setConfirmDate] = useState("");
  function copyLink() { navigator.clipboard.writeText(CALENDLY_LINK); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  function sendSMS() { const phone = lead.phone?.replace(/[^0-9]/g, ""); if (!phone) return; window.open(`https://voice.google.com/u/0/messages?a=nc,${phone}`, "_blank"); setLinkSent(true); }
  function sendEmail() { const fn = lead.owner_name?.split(" ")[0] || "there"; const s = encodeURIComponent("Let's set up a time — Full Stack Services"); const b = encodeURIComponent(`Hey ${fn},\n\nGreat chatting. Here's a link to grab 30 min with Peter:\n\n${CALENDLY_LINK}\n\nPick whatever works.\n\nFull Stack Services LLC\n${COMPANY_PHONE}\n${COMPANY_EMAIL}`); window.open(`mailto:${lead.email || ""}?subject=${s}&body=${b}`, "_self"); setLinkSent(true); }
  function confirmBooked() { if (!confirmDate) return; bookMeeting(lead.id, confirmDate, "00:00", "Booked via Calendly"); }
  return (
    <div className="space-y-5">
      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <div className="font-semibold text-sm text-gray-900">Send Calendly Link</div>
        <p className="text-xs text-gray-500">They pick their own time — no back and forth.</p>
        <p className="text-xs text-amber-600">Tip: Copy first, then hit Text and paste into Google Voice.</p>
        <div className="bg-white border rounded-lg p-3 flex items-center justify-between gap-2"><span className="text-sm text-brand font-medium truncate">{CALENDLY_LINK}</span><button onClick={copyLink} className="flex-shrink-0 px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-200">{copied ? "✓ Copied!" : "Copy"}</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{lead.phone && lead.phone !== "N/A" && <button onClick={sendSMS} className="py-2.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors">📱 Text via Google Voice</button>}<button onClick={sendEmail} className="py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">✉️ Email via Outlook</button></div>
        {linkSent && <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center text-sm text-amber-800">✓ Link sent — mark as Booked once they confirm</div>}
      </div>
      {!lead.meeting_booked && <div className="bg-gray-50 rounded-lg p-4 space-y-3"><div className="font-semibold text-sm text-gray-900">Confirm Meeting</div><p className="text-xs text-gray-500">Once they book via Calendly, enter the date.</p><div><label className="text-xs text-gray-500">Date</label><input type="date" value={confirmDate} onChange={(e: any) => setConfirmDate(e.target.value)} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div><button onClick={confirmBooked} disabled={!confirmDate} className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">✅ Mark as Booked</button></div>}
      {lead.meeting_booked && <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center"><div className="text-2xl mb-2">🎯</div><div className="text-green-800 font-semibold">Meeting Booked!</div>{lead.meeting_date && <div className="text-sm text-green-600 mt-1">{fmt(lead.meeting_date)}</div>}<div className="text-xs text-green-600 mt-2">via Calendly</div></div>}
      {appointments.length > 0 && <div><div className="font-semibold text-sm text-gray-900 mb-2">History</div><div className="space-y-2">{appointments.map((a: Appointment) => <div key={a.id} className="bg-green-50 border border-green-200 rounded-lg p-3"><div className="text-sm font-medium text-green-900">{a.meeting_date}</div>{a.notes && <div className="text-xs text-green-700 mt-1">{a.notes}</div>}</div>)}</div></div>}
    </div>
  );
}

function AddLeadModal({ onClose, onAdd }: { onClose: () => void; onAdd: (data: Partial<Lead>) => Promise<void>; }) {
  const [form, setForm] = useState<Partial<Lead>>({ niche: "General" });
  const set = (k: keyof Lead, v: string) => setForm((prev) => ({ ...prev, [k]: v }));
  async function handleSave() {
    if (!form.business_name?.trim()) return;
    await onAdd(form);
    onClose();
  }
  const field = (label: string, key: keyof Lead, placeholder?: string, type = "text") => (
    <div key={key}>
      <label className="text-xs text-gray-500 uppercase tracking-wide">{label}</label>
      <input type={type} value={(form[key] as string) || ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className="block w-full border rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-brand/30" />
    </div>
  );
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-2 p-4 sm:p-6 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-bold">Add Lead</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button></div>
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b pb-1">Basic Info</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field("Business Name *", "business_name", "Acme Landscaping")}
            {field("Owner Name", "owner_name", "John Smith")}
            {field("Phone", "phone", "+1 480-555-0100")}
            {field("Email", "email", "owner@example.com")}
            {field("Website", "website", "https://example.com")}
            {field("Industry / Niche", "niche", "Landscaping")}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b pb-1">Location</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {field("Address", "address", "123 Main St")}
            {field("City", "city", "Mesa")}
            {field("State", "state", "AZ")}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b pb-1">Company Details</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {field("Employees", "employees", "10")}
            {field("Annual Revenue", "annual_revenue", "$500k")}
            {field("Founded Year", "founded_year", "2015")}
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Short Description</label>
            <textarea value={form.short_description || ""} onChange={(e) => set("short_description", e.target.value)} rows={2} placeholder="Brief company description..." className="block w-full border rounded-lg px-3 py-2 text-sm mt-1 resize-none focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b pb-1">Social / Sales Intel</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field("LinkedIn URL", "linkedin_url", "https://linkedin.com/company/...")}
            {field("Current Software", "current_software", "Jobber, HCP...")}
            {field("Monthly Spend Estimate", "monthly_spend_estimate", "$200/mo")}
            {field("Technologies", "technologies", "WordPress, Slack...")}
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={!form.business_name?.trim()} className="flex-1 py-2.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50">Add Lead</button>
        </div>
      </div>
    </div>
  );
}

function buildQueue(leads: Lead[]): Lead[] {
  const pri = (l: Lead) => {
    if (l.next_follow_up_at && isPast(l.next_follow_up_at)) return 0;
    if (l.status === "Interested") return 1;
    if (l.status === "New")        return 2;
    if (l.status === "No Answer")          return 4;
    if (l.status === "Called")             return 5;
    return 6;
  };
  return [...leads]
    .filter((l) => l.status !== "Dead" && l.status !== "Booked")
    .sort((a, b) => pri(a) - pri(b));
}

type ScrapeStatus = "queued" | "scraping" | "done" | "failed";

function DialerPanel({
  leads,
  onUpdateLead,
  onAddCallLog,
  onClose,
}: {
  leads: Lead[];
  onUpdateLead: (id: string, updates: Partial<Lead>) => Promise<void>;
  onAddCallLog: (log: Omit<CallLog, "id" | "created_at">) => Promise<void>;
  onClose: () => void;
}) {
  const queueIds = useRef(buildQueue(leads).map((l) => l.id)).current;
  const [index, setIndex] = useState(0);
  const [scrapeStatus, setScrapeStatus] = useState<Record<string, ScrapeStatus>>({});
  const [outcome, setOutcome] = useState<CallOutcome>("No answer");
  const [notes, setNotes] = useState("");
  const [software, setSoftware] = useState("");
  const [showGK, setShowGK] = useState(false);

  const currentId   = queueIds[index] ?? null;
  const currentLead = leads.find((l) => l.id === currentId) ?? null;

  // Pre-scrape upcoming leads that are missing phones
  useEffect(() => {
    queueIds.slice(index, index + 4).forEach((id) => {
      if (scrapeStatus[id]) return;
      const lead = leads.find((l) => l.id === id);
      if (!lead) return;
      if (lead.phone && lead.phone !== "N/A") {
        setScrapeStatus((p) => ({ ...p, [id]: "done" }));
        return;
      }
      setScrapeStatus((p) => ({ ...p, [id]: "scraping" }));
      fetch("/api/scrape-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: lead.website, business_name: lead.business_name, city: lead.city }),
      })
        .then((r) => r.json())
        .then((data) => {
          const u: Partial<Lead> = {};
          if (data.phone)                                       u.phone = data.phone;
          if (data.owner   && !lead.owner_name)                u.owner_name = data.owner;
          if (data.email   && !lead.email)                     u.email = data.email;
          if (data.current_software && !lead.current_software) u.current_software = data.current_software;
          if (data.address && !lead.address)                   u.address = data.address;
          if (Object.keys(u).length) onUpdateLead(id, u);
          setScrapeStatus((p) => ({ ...p, [id]: "done" }));
        })
        .catch(() => setScrapeStatus((p) => ({ ...p, [id]: "failed" })));
    });
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  function advance() {
    setNotes(""); setSoftware(""); setOutcome("No answer");
    if (index + 1 >= queueIds.length) { onClose(); return; }
    setIndex((i) => i + 1);
  }

  function logAndNext() {
    if (currentLead) {
      onAddCallLog({
        lead_id: currentLead.id,
        called_at: now(),
        outcome,
        notes,
        current_software: software || currentLead.current_software,
      });
    }
    advance();
  }

  const isCurrentScraping = !!currentLead && !currentLead.phone && scrapeStatus[currentId!] === "scraping";
  const upNext = queueIds.slice(index + 1, index + 4)
    .map((id) => leads.find((l) => l.id === id))
    .filter((l): l is Lead => !!l);

  if (!currentLead) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold">⚡ Power Dialer</span>
          <span className="text-gray-500 text-sm">
            {index + 1} / {queueIds.length}
          </span>
          <div className="w-32 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${((index + 1) / queueIds.length) * 100}%` }} />
          </div>
        </div>
        <button onClick={onClose} className="px-3 py-1.5 bg-gray-800 text-gray-400 text-sm rounded-lg hover:bg-gray-700">Stop</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-5 space-y-4">

          {/* Current lead card */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white leading-tight">{currentLead.business_name}</h2>
                <p className="text-gray-400 text-sm mt-0.5">
                  {currentLead.owner_name || "Owner unknown"} · {currentLead.city || "—"}
                </p>
                {currentLead.current_software && (
                  <span className="inline-block mt-1.5 text-xs bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded-full">
                    Uses {currentLead.current_software}
                  </span>
                )}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[currentLead.status]}`}>
                {currentLead.status}
              </span>
            </div>

            {/* Phone + actions */}
            <div className="mb-3">
              {isCurrentScraping ? (
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <div className="w-3.5 h-3.5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  Finding phone number…
                </div>
              ) : currentLead.phone && currentLead.phone !== "N/A" ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-2xl font-bold text-white tracking-wide">{currentLead.phone}</span>
                  <a href={`https://voice.google.com/u/0/calls?a=nc,${currentLead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="px-4 py-2 bg-brand text-white font-semibold rounded-xl hover:bg-brand-dark text-sm">📞 Call</a>
                  <a href={`https://voice.google.com/u/0/messages?a=nc,${currentLead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 text-sm">💬 Text</a>
                </div>
              ) : (
                <span className="text-gray-600 text-sm">
                  {scrapeStatus[currentLead.id] === "failed" ? "No number found" : "No phone number"}
                </span>
              )}
            </div>
            {currentLead.email && <p className="text-gray-500 text-xs">✉️ {currentLead.email}</p>}
            {currentLead.address && <p className="text-gray-500 text-xs mt-0.5">📍 {currentLead.address}</p>}
            {currentLead.website && currentLead.website !== "N/A" && (
              <a href={currentLead.website.startsWith("http") ? currentLead.website : `https://${currentLead.website}`} target="_blank" rel="noreferrer" className="text-xs text-gray-600 hover:text-gray-400 mt-0.5 block truncate">🌐 {currentLead.website}</a>
            )}
          </div>

          {/* Gatekeeper quick ref */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <button onClick={() => setShowGK(!showGK)} className="flex items-center justify-between w-full px-4 py-3 text-left">
              <span className="text-orange-400 text-sm font-semibold">🚪 Gatekeeper Scripts</span>
              <span className="text-gray-600 text-xs">{showGK ? "Hide" : "Show"}</span>
            </button>
            {showGK && (
              <div className="px-4 pb-4 space-y-2">
                {GATEKEEPER_SCRIPTS.map((g, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-3">
                    <div className="text-xs font-semibold text-orange-500 uppercase tracking-wide">{g.situation}</div>
                    <div className="text-sm text-gray-200 mt-1 italic">&ldquo;{g.line}&rdquo;</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outcome */}
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Outcome</p>
            <div className="flex flex-wrap gap-2">
              {CALL_OUTCOMES.map((o) => (
                <button key={o} onClick={() => setOutcome(o)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${outcome === o ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* Software + notes */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-wide">Their Software</label>
              <input value={software} onChange={(e) => setSoftware(e.target.value)} placeholder="Jobber, HCP…" className="mt-1 w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600/50" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-wide">Quick Note</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened…" className="mt-1 w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-600/50" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={advance} className="px-5 py-3 bg-gray-800 text-gray-400 font-medium rounded-xl hover:bg-gray-700 text-sm">Skip →</button>
            <button onClick={logAndNext} className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 text-sm">Log & Next →</button>
          </div>

          {/* Up next */}
          {upNext.length > 0 && (
            <div>
              <p className="text-gray-600 text-xs uppercase tracking-wide mb-2">Up Next</p>
              <div className="space-y-1.5">
                {upNext.map((lead) => (
                  <div key={lead.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-gray-300 text-sm truncate">{lead.business_name}</div>
                      {lead.current_software && <div className="text-gray-600 text-xs">Uses {lead.current_software}</div>}
                    </div>
                    <div className="flex-shrink-0 text-xs">
                      {scrapeStatus[lead.id] === "scraping" ? (
                        <span className="text-yellow-500 flex items-center gap-1"><div className="w-2.5 h-2.5 border border-yellow-500 border-t-transparent rounded-full animate-spin" />Scanning</span>
                      ) : lead.phone && lead.phone !== "N/A" ? (
                        <span className="text-green-500">✓ {lead.phone}</span>
                      ) : scrapeStatus[lead.id] === "failed" ? (
                        <span className="text-gray-700">No number</span>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Done state */}
          {index + 1 >= queueIds.length && (
            <div className="text-center py-4 text-gray-500 text-sm">Last lead in queue</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (leads: Partial<Lead>[]) => Promise<number>; }) {
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; setCsvText(await f.text()); }
  async function handleImport() {
    if (!csvText.trim()) return;
    try {
      const Papa = (await import("papaparse")).default;
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      const leads = parsed.data.map((row: any) => ({ business_name: row["Company Name"] || row.business_name || row["Business Name"] || row.Company || "", owner_name: row.owner_name || row["Owner Name"] || row.Owner || "", phone: (row["Company Phone"] || row.phone || row.Phone || "").replace(/^'+/, ""), email: row.email || row.Email || "", website: row.Website || row.website || "", address: row["Company Address"] || row.address || row.Address || "", city: row["Company City"] || row.city || row.City || "", state: row["Company State"] || row.state || "", postal_code: row["Company Postal Code"] || row.postal_code || "", niche: row.Industry || row.industry || row.niche || row.Niche || "General", industry: row.Industry || row.industry || "", employees: row["# Employees"] || row.employees || "", annual_revenue: row["Annual Revenue"] || row.annual_revenue || "", founded_year: row["Founded Year"] || row.founded_year || "", short_description: row["Short Description"] || row.short_description || "", technologies: row.Technologies || row.technologies || "", keywords: row.Keywords || row.keywords || "", linkedin_url: row["Company Linkedin Url"] || row.linkedin_url || "", facebook_url: row["Facebook Url"] || row.facebook_url || "", twitter_url: row["Twitter Url"] || row.twitter_url || "", apollo_account_id: row["Apollo Account Id"] || row.apollo_account_id || "", current_software: row.current_software || row["Current Software"] || "" })).filter((l: any) => l.business_name);
      const count = await onImport(leads);
      setResult(`Imported ${count} new leads (${leads.length - count} duplicates skipped)`);
    } catch { setResult("Error parsing file."); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-2 p-4 sm:p-6 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-bold">Import Leads</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button></div>
        <p className="text-sm text-gray-500 mb-4">Upload Apollo CSV export or any CSV with columns: Company Name, Company Phone, Website, Industry, Company City, etc. All Apollo fields are supported.</p>
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} title="Upload CSV file" placeholder="Choose a file" className="block w-full text-sm border rounded-lg px-3 py-2" />
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} placeholder="business_name,owner_name,phone..." className="block w-full border rounded-lg px-3 py-2 text-sm font-mono resize-none" />
          {result && <div className={`text-sm p-3 rounded-lg ${result.includes("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{result}</div>}
          <button onClick={handleImport} disabled={!csvText.trim()} className="w-full py-2.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50">Import Leads</button>
        </div>
      </div>
    </div>
  );
}