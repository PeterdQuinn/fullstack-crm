"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getStatusStyle } from "@/lib/status-colors";

// The bar block and the table block used to render identical numbers, one
// directly under the other — the old code even labelled the second block as the
// same numbers again. A reader had to check whether it said anything new; it
// never did. The bar now lives inside the table row, so each number appears once.

interface Stage { status: string; count: number; pct: number; terminal: boolean }
interface Touch { touch: string; sent: number; opened: number; replied: number }
interface ReportData {
  range: string;
  total: number;
  pipeline: Stage[];
  funnel: { sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number; failed: number };
  rates: { delivered: number; opened: number; clicked: number; replied: number; bounced: number };
  touches: Touch[];
  supply: { totalLeads: number; mailable: number; readyAwaitingEmail: number; inSequence: number };
  error?: string;
}

type Range = "30" | "90" | "all";
const RANGE_LABELS: Record<Range, string> = { "30": "Last 30 days", "90": "Last 90 days", all: "All time" };

function Tile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "warn" | "bad" }) {
  const ink = tone === "bad" ? "text-status-lost" : tone === "warn" ? "text-status-warm" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${ink}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>("all");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (r: Range) => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/crm/reports?range=${r}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load reports");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  const maxStage = data ? Math.max(1, ...data.pipeline.map((s) => s.count)) : 1;
  const f = data?.funnel;
  const funnelSteps = f
    ? [
        { label: "Sent", value: f.sent, pct: 100 },
        { label: "Delivered", value: f.delivered, pct: data!.rates.delivered },
        { label: "Opened", value: f.opened, pct: data!.rates.opened },
        { label: "Clicked", value: f.clicked, pct: data!.rates.clicked },
        { label: "Replied", value: f.replied, pct: data!.rates.replied },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Reports</h1>
          <p className="text-xs text-gray-400 sm:text-sm">Every lead by stage, and what the email is doing.</p>
        </div>
        <button onClick={() => router.back()} className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">← Back</button>
      </div>

      <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)}
            className={`min-h-[40px] rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${range === r ? "bg-brand text-white" : "text-gray-600 hover:bg-gray-50"}`}>
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {loading ? <p className="text-gray-500">Loading…</p>
      : error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-status-lost">{error}</p>
      : !data ? null : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Supply</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Total leads" value={data.supply.totalLeads.toLocaleString()} />
              <Tile label="Mailable" value={data.supply.mailable.toLocaleString()} hint="has an address we can use" />
              <Tile label="Ready, no email" value={data.supply.readyAwaitingEmail.toLocaleString()} hint="qualified but uncontactable" tone={data.supply.readyAwaitingEmail > 0 ? "warn" : undefined} />
              <Tile label="In sequence" value={data.supply.inSequence.toLocaleString()} hint="touch 1–3 underway" />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Email performance</h2>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Open rate" value={`${data.rates.opened}%`} hint={`${data.funnel.opened} of ${data.funnel.sent}`} />
              <Tile label="Click rate" value={`${data.rates.clicked}%`} hint={`${data.funnel.clicked} of ${data.funnel.sent}`} />
              <Tile label="Reply rate" value={`${data.rates.replied}%`} hint={`${data.funnel.replied} of ${data.funnel.sent}`} />
              <Tile label="Bounce rate" value={`${data.rates.bounced}%`} hint={`${data.funnel.bounced} of ${data.funnel.sent}`} tone={data.rates.bounced >= 5 ? "bad" : undefined} />
            </div>
            <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              {funnelSteps.map((step) => (
                <div key={step.label} className="flex items-center gap-3" title={`${step.label}: ${step.value} (${step.pct}% of sent)`}>
                  <div className="w-24 shrink-0 text-sm font-medium text-gray-700">{step.label}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                    <div className="h-full rounded bg-brand" style={{ width: `${Math.max(step.value > 0 ? 1 : 0, (step.value / Math.max(1, f!.sent)) * 100)}%` }} />
                  </div>
                  <div className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-600">
                    <span className="font-semibold text-gray-900">{step.value.toLocaleString()}</span> · {step.pct}%
                  </div>
                </div>
              ))}
            </div>
            {data.funnel.sent > 0 && data.funnel.opened === 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Open and click tracking was enabled after these sends went out. Engagement only appears for mail sent from that point forward.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">By touch</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-semibold">Touch</th>
                    <th className="px-4 py-3 text-right font-semibold">Sent</th>
                    <th className="px-4 py-3 text-right font-semibold">Opened</th>
                    <th className="px-4 py-3 text-right font-semibold">Replied</th>
                  </tr>
                </thead>
                <tbody>
                  {data.touches.map((t) => (
                    <tr key={t.touch} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-gray-900">{t.touch}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{t.sent}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{t.opened}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{t.replied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Every stage <span className="font-normal normal-case tracking-normal text-gray-400">· {data.total.toLocaleString()} leads</span>
            </h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Share</th>
                    <th className="px-4 py-3 text-right font-semibold">Count</th>
                    <th className="px-4 py-3 text-right font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pipeline.map((s) => (
                    <tr key={s.status} className={`border-b border-gray-100 last:border-0 ${s.terminal ? "bg-gray-50/60" : ""}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                        <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${getStatusStyle(s.status).dot}`} />
                        {s.status}
                        {s.terminal && <span className="ml-2 text-xs font-normal text-gray-400">closed</span>}
                      </td>
                      <td className="w-1/2 px-4 py-3">
                        <div className="h-2.5 w-full overflow-hidden rounded bg-gray-100" title={`${s.status}: ${s.count} (${s.pct}%)`}>
                          <div className={`h-full rounded ${getStatusStyle(s.status).dot}`} style={{ width: `${(s.count / maxStage) * 100}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{s.count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{s.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
