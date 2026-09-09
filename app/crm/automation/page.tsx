"use client";
import { useCallback, useEffect, useState } from "react";

// The control panel for the whole system.
//
// This was a settings form with two logs stapled underneath, and it answered
// none of the questions you open it to ask. Whether automation is on was a
// checkbox in the middle of a form; whether anything had failed meant reading a
// raw JSON dump; what it had done today, and when it next runs, were not shown
// at all. State first, settings second.

interface Stage {
  stage: string; label: string; description: string;
  runs24h: number; failed24h: number;
  lastStatus: string | null; lastRunAt: string | null; nextRunAt: string; error: string | null; broken: boolean;
}
interface Data {
  settings: { enabled: boolean; niches: string[]; locations: { city: string; state: string }[] };
  today: { sent: number; cap: number; discovered: number; researched: number };
  stages: Stage[];
  health: { runs24h: number; failed24h: number; brokenStages: string[]; recoveredStages: string[] };
  outbox: { counts: Record<string, number>; total: number; needsAttention: any[] };
}

function when(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.parse(iso) - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const text = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "bad" ? "text-status-lost" : "text-gray-900"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

export default function AutomationPage() {
  const [data, setData] = useState<Data | null>(null);
  const [niches, setNiches] = useState("");
  const [locations, setLocations] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/crm/automation", { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setData(body);
    setNiches(body.settings.niches.join("\n"));
    setLocations(body.settings.locations.map((l: any) => `${l.city}, ${l.state}`).join("\n"));
  }, []);

  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);

  function parsedSettings(enabled: boolean) {
    const places = locations.split("\n").filter((l) => l.trim()).map((l) => {
      const i = l.lastIndexOf(",");
      return { city: l.slice(0, i).trim(), state: l.slice(i + 1).trim().toUpperCase() };
    });
    return { enabled, niches: niches.split("\n").map((n) => n.trim()).filter(Boolean), locations: places };
  }

  async function put(payload: any, done: string) {
    const r = await fetch("/api/crm/automation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    await load();
    setMessage(done);
  }

  // Turning this on starts mailing real businesses. It gets a confirmation and
  // its own button, not a checkbox the cursor can find by accident.
  async function toggle() {
    if (!data) return;
    const turningOn = !data.settings.enabled;
    if (turningOn && !window.confirm(
      `Start automation?\n\nIt will send up to ${data.today.cap} cold emails a day to real businesses, on the schedule below.`
    )) return;
    setToggling(true); setMessage("");
    try {
      await put(parsedSettings(turningOn), turningOn ? "Automation is running." : "Automation is paused. Nothing will send.");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setToggling(false); }
  }

  async function save() {
    if (!data) return;
    setSaving(true); setMessage("");
    try { await put(parsedSettings(data.settings.enabled), "Targeting saved. Scheduled runs will use it."); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  if (!data) {
    return <main className="mx-auto max-w-5xl px-4 py-8"><p className="text-gray-500">{message || "Loading…"}</p></main>;
  }

  const on = data.settings.enabled;
  const broken = data.health.brokenStages;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Automation</h1>
        <p className="text-xs text-gray-400 sm:text-sm">Whether the system is running, and what it has done.</p>
      </div>

      {message && <p role="status" className="rounded-lg bg-brand-light px-3 py-2 text-sm font-medium text-brand-dark">{message}</p>}

      <section className={`rounded-xl border p-5 ${on ? "border-brand bg-brand-light" : "border-gray-300 bg-gray-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-block h-3 w-3 rounded-full ${on ? "bg-status-won" : "bg-gray-400"}`} />
              <span className="text-lg font-bold text-gray-900">{on ? "Running" : "Paused"}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {on
                ? `Sending up to ${data.today.cap} cold emails a day on the schedule below.`
                : "Nothing will be discovered, scored, or sent until you turn this on."}
            </p>
          </div>
          <button onClick={toggle} disabled={toggling}
            className={`min-h-[44px] rounded-lg px-5 py-2.5 font-semibold text-white disabled:opacity-50 ${on ? "bg-gray-700 hover:bg-gray-800" : "bg-brand hover:bg-brand-dark"}`}>
            {toggling ? "Saving…" : on ? "Pause automation" : "Start automation"}
          </button>
        </div>
      </section>

      {broken.length > 0 && (
        <section className="rounded-xl border border-status-lost bg-red-50 p-4">
          <p className="font-semibold text-status-lost">{broken.join(", ")} {broken.length === 1 ? "is" : "are"} failing</p>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {data.stages.filter((s) => s.broken && s.error).map((s) => (
              <li key={s.stage}><span className="font-medium">{s.label}:</span> {s.error}</li>
            ))}
          </ul>
        </section>
      )}

      {data.health.recoveredStages.length > 0 && (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          {data.health.recoveredStages.join(", ")} failed earlier today and {data.health.recoveredStages.length === 1 ? "has" : "have"} since recovered.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Today</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Emails sent" value={`${data.today.sent} / ${data.today.cap}`} hint="against the daily cap" />
          <Tile label="Leads found" value={String(data.today.discovered)} />
          <Tile label="Researched" value={String(data.today.researched)} />
          <Tile label="Failed runs" value={String(data.health.failed24h)} hint={`of ${data.health.runs24h} in 24h`}
            tone={data.health.failed24h > 0 ? "bad" : undefined} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Stages</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">Last run</th>
                <th className="px-4 py-3 font-semibold">24h</th>
                <th className="px-4 py-3 font-semibold">Next</th>
              </tr>
            </thead>
            <tbody>
              {data.stages.map((s) => {
                const bad = s.broken;
                return (
                  <tr key={s.stage} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{s.label}</div>
                      <div className="text-xs text-gray-400">{s.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${bad ? "text-status-lost" : s.lastStatus ? "text-gray-700" : "text-gray-400"}`}>
                        {s.lastStatus === "died" ? "died mid-run" : s.lastStatus || "not yet"}
                      </span>
                      <div className="text-xs text-gray-400">{when(s.lastRunAt)}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">
                      {s.runs24h}{s.failed24h > 0 && <span className="text-status-lost"> · {s.failed24h} failed</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{on ? when(s.nextRunAt) : <span className="text-gray-400">paused</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Outgoing mail <span className="font-normal normal-case tracking-normal text-gray-400">
            · {Object.entries(data.outbox.counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing yet"}
          </span>
        </h2>
        {data.outbox.needsAttention.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Nothing stuck. Messages only appear here when they need a decision.
          </p>
        ) : (
          <div className="space-y-2">
            {data.outbox.needsAttention.map((o: any) => (
              <div key={o.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{o.recipient}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-status-warm">
                    {o.status === "needs_review" ? "needs review" : o.accepted_at && !o.finalized_at ? "tracking incomplete" : o.status}
                  </span>
                </div>
                <p className="text-gray-600">{o.subject}</p>
                {o.error_message && <p className="mt-1 text-xs text-status-lost">{o.error_message}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <button onClick={() => setShowSettings((v) => !v)}
          className="text-sm font-semibold text-brand hover:underline">
          {showSettings ? "Hide targeting" : "Targeting settings"} {showSettings ? "▲" : "▼"}
        </button>
        {showSettings && (
          <div className="mt-3 space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-600">
              Discovery rotates through these niches and cities, one pairing per run. New first emails use this niche
              list; sequences already underway finish regardless, unless stopped by a reply, an unsubscribe, or a
              delivery problem.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Business niches — one per line
                <textarea className="mt-1 block min-h-56 w-full rounded-lg border border-gray-300 p-3 text-sm"
                  value={niches} onChange={(e) => setNiches(e.target.value)} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                US locations — City, ST
                <textarea className="mt-1 block min-h-56 w-full rounded-lg border border-gray-300 p-3 text-sm"
                  value={locations} onChange={(e) => setLocations(e.target.value)} />
              </label>
            </div>
            <button disabled={saving} onClick={save}
              className="min-h-[44px] rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              {saving ? "Saving…" : "Save targeting"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
