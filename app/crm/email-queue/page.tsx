"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, Clipboard, ExternalLink, Mail, Phone, Search, Send, ShieldCheck, UserRound, X } from "lucide-react";

interface HistoryItem {
  id: string;
  direction?: string;
  message_type?: string;
  subject?: string;
  status?: string;
  sent_at?: string;
  delivered_at?: string;
  opened_at?: string;
  clicked_at?: string;
  replied_at?: string;
  bounced_at?: string;
}

interface QueueLead {
  id: string;
  business_name: string;
  contact_name?: string | null;
  owner_name?: string | null;
  email: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  industry?: string;
  short_description?: string;
  current_software?: string;
  monthly_spend_estimate?: string;
  next_follow_up_at?: string;
  score: number;
  confidence?: string;
  main_pain_point?: string;
  best_attack_angle?: string;
  history: HistoryItem[];
  status: string;
  email_sent_count: number;
  emailNum: number;
  subject: string;
  bodyText: string;
  copyText: string;
}

interface Safety {
  sentToday: number;
  dailyCap: number;
  remaining: number;
  bounced: number;
  complained: number;
  blockedReason?: string | null;
}

type Tab = "message" | "research" | "history";
type Filter = "ready" | "followups" | "waiting" | "all";

function cleanStatus(value: string) { return value.replaceAll("-", " "); }
function dateText(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function isWaiting(lead: QueueLead) { return Boolean(lead.next_follow_up_at && new Date(lead.next_follow_up_at) > new Date()); }

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export default function EmailQueuePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<QueueLead[]>([]);
  const [safety, setSafety] = useState<Safety>({ sentToday: 0, dailyCap: 40, remaining: 40, bounced: 0, complained: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("message");
  const [filter, setFilter] = useState<Filter>("ready");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadQueue() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/email/queue", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load email workspace");
      const nextLeads = Array.isArray(data.leads) ? data.leads : [];
      setLeads(nextLeads);
      setSafety(data.safety || safety);
      setSelectedId((current) => current && nextLeads.some((lead: QueueLead) => lead.id === current) ? current : null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load email workspace");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadQueue(); }, []);

  const counts = useMemo(() => ({
    ready: leads.filter((lead) => lead.emailNum === 1 && !isWaiting(lead)).length,
    followups: leads.filter((lead) => lead.emailNum > 1 && !isWaiting(lead)).length,
    waiting: leads.filter(isWaiting).length,
    all: leads.length,
  }), [leads]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesSearch = !term || [lead.business_name, lead.owner_name, lead.contact_name, lead.email, lead.city]
        .some((value) => value?.toLowerCase().includes(term));
      const matchesFilter = filter === "all" || filter === "waiting" && isWaiting(lead)
        || filter === "ready" && lead.emailNum === 1 && !isWaiting(lead)
        || filter === "followups" && lead.emailNum > 1 && !isWaiting(lead);
      return matchesSearch && matchesFilter;
    });
  }, [leads, search, filter]);

  const selected = leads.find((lead) => lead.id === selectedId) || null;
  const canSend = selected && !isWaiting(selected) && safety.remaining > 0 && !safety.blockedReason;

  async function sendSelected() {
    if (!selected || !canSend) return;
    if (!window.confirm(`Send email ${selected.emailNum} to ${selected.email}?`)) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/email/send-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.blocked || "Could not send the email");
      setNotice(`Email ${data.emailNum} sent to ${selected.business_name}`);
      setSelectedId(null);
      await loadQueue();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not send the email");
    } finally { setWorking(false); }
  }

  async function runAction(action: "skip" | "move_to_calls" | "bad_email" | "do_not_contact") {
    if (!selected) return;
    if (action === "do_not_contact" && !window.confirm(`Mark ${selected.business_name} as Do Not Contact?`)) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/email/queue-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the lead");
      setNotice(`${selected.business_name} updated`);
      setSelectedId(null);
      await loadQueue();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update the lead");
    } finally { setWorking(false); }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-100 text-slate-700" aria-label="Go back"><ArrowLeft size={20} /></button>
            <div><h1 className="text-xl font-bold sm:text-2xl">Email Workspace</h1><p className="text-sm text-slate-500">Review one lead and one message at a time</p></div>
          </div>
          <div className="hidden items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-emerald-800 sm:flex"><ShieldCheck size={20} /><div><div className="text-sm font-bold">{safety.remaining} sends left</div><div className="text-xs">{safety.sentToday} of {safety.dailyCap} used today</div></div></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <div className="rounded-lg bg-white p-3 shadow-sm"><div className="text-xl font-bold">{leads.length}</div><div className="text-xs text-slate-500">In workspace</div></div>
          <div className="rounded-lg bg-white p-3 shadow-sm"><div className="text-xl font-bold text-emerald-700">{safety.remaining}</div><div className="text-xs text-slate-500">Sends left</div></div>
          <div className="rounded-lg bg-white p-3 shadow-sm"><div className="text-xl font-bold text-amber-700">{counts.waiting}</div><div className="text-xs text-slate-500">Waiting</div></div>
          <div className="hidden rounded-lg bg-white p-3 shadow-sm sm:block"><div className="text-xl font-bold text-red-700">{safety.bounced}</div><div className="text-xs text-slate-500">Bounced</div></div>
          <div className="hidden rounded-lg bg-white p-3 shadow-sm sm:block"><div className="text-xl font-bold text-red-700">{safety.complained}</div><div className="text-xs text-slate-500">Complaints</div></div>
        </div>
        {safety.blockedReason && <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800"><AlertTriangle className="shrink-0" size={19} />{safety.blockedReason}</div>}
        {notice && <div className="mt-3 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 size={19} />{notice}</div>}
        {error && <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800"><AlertTriangle size={19} />{error}</div>}
      </div>

      <main className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[350px_minmax(0,1fr)]">
        <aside className={`${selected ? "hidden lg:block" : "block"} rounded-xl border border-slate-200 bg-white shadow-sm`}>
          <div className="space-y-3 border-b border-slate-200 p-3">
            <div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email leads" className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div>
            <div className="grid grid-cols-4 gap-1">{(["ready", "followups", "waiting", "all"] as Filter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-1 py-2 text-xs font-semibold capitalize ${filter === item ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600"}`}>{item}<span className="ml-1">{counts[item]}</span></button>)}</div>
          </div>
          <div className="max-h-[calc(100vh-315px)] overflow-y-auto p-2">
            {loading ? <p className="p-4 text-sm text-slate-500">Loading email information...</p> : filtered.length === 0 ? <p className="p-4 text-sm text-slate-500">No leads in this group</p> : filtered.map((lead) => <button key={lead.id} onClick={() => { setSelectedId(lead.id); setTab("message"); }} className={`mb-2 w-full rounded-lg border p-3 text-left ${lead.id === selectedId ? "border-blue-500 bg-blue-50" : "border-transparent bg-slate-50 hover:border-slate-300"}`}>
              <div className="flex items-start justify-between gap-2"><div className="font-semibold">{lead.business_name}</div><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{lead.score}</span></div>
              <div className="mt-1 truncate text-sm text-slate-600">{lead.owner_name || lead.contact_name || "Owner not recorded"}</div>
              <div className="mt-2 flex justify-between gap-2 text-xs text-slate-500"><span>Email {lead.emailNum} of 3</span><span>{lead.city || "City not recorded"}</span></div>
              {isWaiting(lead) && <div className="mt-2 text-xs font-semibold text-amber-700">Ready {dateText(lead.next_follow_up_at)}</div>}
            </button>)}
          </div>
        </aside>

        {!selected ? <section className="hidden min-h-[500px] items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 lg:flex"><div><Mail className="mx-auto mb-3" size={42} /><div className="font-semibold">Select a lead to review the message</div></div></section> : <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold sm:text-2xl">{selected.business_name}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{cleanStatus(selected.status)}</span><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Score {selected.score}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600"><span className="flex items-center gap-1"><UserRound size={15} />{selected.owner_name || selected.contact_name || "Owner not recorded"}</span><span className="flex items-center gap-1"><Mail size={15} />{selected.email}</span></div></div><button onClick={() => setSelectedId(null)} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-100 lg:hidden" aria-label="Close lead"><X size={20} /></button></div>
            <div className="mt-4 grid grid-cols-3 rounded-lg bg-slate-100 p-1">{(["message", "research", "history"] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={`min-h-[40px] rounded-md text-sm font-semibold capitalize ${tab === item ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>{item}</button>)}</div>
          </div>

          <div className="min-h-[420px] p-4 sm:p-5">
            {tab === "message" && <div className="space-y-4"><div className="rounded-lg border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm"><span className="font-semibold text-slate-500">To: </span>{selected.email}</div><div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm"><span className="font-semibold text-slate-500">Subject: </span>{selected.subject}</div><pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-sm leading-7 text-slate-800">{selected.bodyText}</pre></div></div>}
            {tab === "research" && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Info label="Industry" value={selected.industry} /><Info label="Location" value={[selected.address, selected.city, selected.state].filter(Boolean).join(", ")} /><Info label="Current software" value={selected.current_software} /><Info label="Monthly software spend" value={selected.monthly_spend_estimate} /></div>{selected.short_description && <Research title="Company profile" text={selected.short_description} />}{selected.main_pain_point && <Research title="Main pain point" text={selected.main_pain_point} />}{selected.best_attack_angle && <Research title="Best talking angle" text={selected.best_attack_angle} />}<div className="flex flex-wrap gap-2">{selected.phone && <a href={`tel:${selected.phone}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-700 px-4 text-sm font-semibold text-white"><Phone size={17} />Call</a>}{selected.website && <a href={selected.website.startsWith("http") ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white"><ExternalLink size={17} />Website</a>}<a href={`/crm/leads?lead=${selected.id}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-700"><Building2 size={17} />Full lead</a></div></div>}
            {tab === "history" && <div>{selected.history.length === 0 ? <p className="text-sm text-slate-500">No previous email activity</p> : <div className="space-y-3">{selected.history.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{cleanStatus(item.message_type || "Email activity")}</span><span className="text-xs text-slate-500">{dateText(item.sent_at || item.replied_at)}</span></div>{item.subject && <div className="mt-2 text-sm text-slate-700">{item.subject}</div>}<div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cleanStatus(item.status || item.direction || "Recorded")}</div></div>)}</div>}</div>}
          </div>

          <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><button onClick={sendSelected} disabled={!canSend || working} className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"><Send size={18} />{isWaiting(selected) ? "Waiting for follow up date" : `Send email ${selected.emailNum}`}</button><button onClick={async () => { await copyText(selected.copyText); setNotice("Email copied"); }} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 font-semibold text-white"><Clipboard size={18} />Copy</button><button onClick={() => runAction("skip")} disabled={working} className="min-h-[48px] rounded-lg bg-amber-100 px-4 font-semibold text-amber-800">Skip until tomorrow</button></div><div className="mt-2 grid grid-cols-3 gap-2"><button onClick={() => runAction("move_to_calls")} disabled={working} className="min-h-[44px] rounded-lg bg-slate-100 px-2 text-xs font-semibold text-slate-700">Move to Calls</button><button onClick={() => runAction("bad_email")} disabled={working} className="min-h-[44px] rounded-lg bg-red-50 px-2 text-xs font-semibold text-red-700">Bad Email</button><button onClick={() => runAction("do_not_contact")} disabled={working} className="min-h-[44px] rounded-lg bg-red-100 px-2 text-xs font-semibold text-red-800">Do Not Contact</button></div></div>
        </section>}
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) { return <div className="rounded-lg bg-slate-50 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm font-medium">{value || "Not recorded"}</div></div>; }
function Research({ title, text }: { title: string; text: string }) { return <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div><p className="mt-2 text-sm leading-7 text-slate-700">{text}</p></div>; }
