"use client";
import { useEffect, useState } from "react";

export default function AutomationPage() {
  const [data, setData] = useState<any>(null);
  const [niches, setNiches] = useState("");
  const [locations, setLocations] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function load() {
    const r = await fetch("/api/crm/automation", { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setData(body); setNiches(body.settings.niches.join("\n"));
    setLocations(body.settings.locations.map((l: any) => `${l.city}, ${l.state}`).join("\n"));
    setEnabled(body.settings.enabled);
  }
  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);
  async function save() {
    setSaving(true); setMessage("");
    try {
      const places = locations.split("\n").filter(l => l.trim()).map(l => {
        const i = l.lastIndexOf(",");
        return { city: l.slice(0, i).trim(), state: l.slice(i + 1).trim().toUpperCase() };
      });
      const r = await fetch("/api/crm/automation", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, niches: niches.split("\n").map(n => n.trim()).filter(Boolean), locations: places }) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error);
      await load(); setMessage("Saved. Scheduled runs will use these targets.");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-3xl font-bold">Automation</h1>
    <p>Discovery runs daily. Enrichment, scoring and initial emails run three times a day. Replies and due follow-ups are checked hourly, 7 AM–4 PM Phoenix time. Up to 40 automated prospect emails per day.</p>
    <p role="status" className="font-semibold">{message}</p>
    {!data ? <p>Loading saved settings…</p> : <>
      <section className="space-y-4 rounded-xl border bg-white p-5">
        <label className="flex gap-3 font-semibold"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Run automatically</label>
        <p>Choose the niches and cities to rotate through. New initial emails use your saved niche list. Existing email sequences continue until completed or stopped by a reply, unsubscribe, or delivery problem.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">Business niches — one per line<textarea className="block min-h-64 w-full rounded border p-3" value={niches} onChange={e => setNiches(e.target.value)} /></label>
          <label className="space-y-2">US locations — City, ST<textarea className="block min-h-64 w-full rounded border p-3" value={locations} onChange={e => setLocations(e.target.value)} /></label>
        </div>
        <button disabled={saving} onClick={save} className="rounded bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save targeting and automation"}</button>
      </section>
      <section className="space-y-3"><h2 className="text-xl font-bold">Saved email activity</h2>
        <p>Sent means the email provider accepted the message; inbox delivery is tracked separately. “Needs review” prevents an uncertain old attempt from being sent twice.</p>
        {data.outbox.length === 0 && <p>No messages in the new saved outbox yet.</p>}
        {data.outbox.map((o: any) => <div className="rounded border bg-white p-3" key={o.id}><strong>{o.recipient}</strong> — {o.status}{o.accepted_at && !o.finalized_at ? " · tracking recovery pending" : ""}<p>{o.subject}</p>{o.error_message && <p className="text-red-700">{o.error_message}</p>}</div>)}
      </section>
      <section className="space-y-3"><h2 className="text-xl font-bold">Saved automation runs</h2>
        {data.runs.length === 0 && <p>New scheduled runs will appear here.</p>}
        {data.runs.map((r: any) => <details className="rounded border bg-white p-3" key={r.id}><summary>{r.stage} — {r.status === "running" && Date.parse(r.started_at) < Date.now() - 180000 ? "interrupted or timed out" : r.status} · {new Date(r.started_at).toLocaleString()}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(r.result, null, 2)}</pre></details>)}
      </section>
    </>}
  </main>;
}
