"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SuppressedLead {
  id: string;
  company: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  reasons: string[];
  date_flagged?: string | null;
  original_status?: string | null;
  current_status?: string | null;
  permanent: boolean;
  callable: boolean;
}
interface Summary { total: number; permanent: number; emailOnly: number; callable: number }

const REASON_STYLE: Record<string, string> = {
  bounced: "bg-status-warm/10 text-status-warm",
  bad_address: "bg-status-warm/10 text-status-warm",
  complained: "bg-status-lost/10 text-status-lost",
  opt_out: "bg-gray-200 text-gray-700",
};
const REASON_LABEL: Record<string, string> = {
  bounced: "bounced", bad_address: "bad address", complained: "complained", opt_out: "unsubscribed",
};

function Section({ title, blurb, rows, showPhone }: { title: string; blurb: string; rows: SuppressedLead[]; showPhone?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-900">{title} <span className="font-normal text-gray-400">· {rows.length}</span></h2>
      <p className="mb-3 text-xs text-gray-500">{blurb}</p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              {showPhone && <th className="px-4 py-3 font-semibold">Phone</th>}
              <th className="px-4 py-3 font-semibold">Reason</th>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{r.company}</td>
                <td className="px-4 py-3 text-gray-600">{r.contact || r.email || "—"}</td>
                {showPhone && (
                  <td className="px-4 py-3 tabular-nums text-gray-600">
                    {r.phone ? <a href={`tel:${r.phone}`} className="font-medium text-brand hover:underline">{r.phone}</a> : "—"}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    {r.reasons.map((reason) => (
                      <span key={reason} className={`rounded-full px-2 py-0.5 text-xs font-medium ${REASON_STYLE[reason] || "bg-gray-100 text-gray-600"}`}>
                        {REASON_LABEL[reason] || reason}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(r.date_flagged)}</td>
                <td className="px-4 py-3 text-right">
                  {r.callable
                    ? <Link href="/crm/call-queue" className="text-sm font-medium text-brand hover:underline">Call queue →</Link>
                    : <Link href="/crm/leads" className="text-sm font-medium text-gray-500 hover:underline">View lead</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SuppressedPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SuppressedLead[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/crm/suppressed", { cache: "no-store" });
        const body = await res.json();
        setRows(body.rows || []);
        setSummary(body.summary || null);
      } catch (e) {
        console.error("Error loading suppressed leads:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const permanent = rows.filter((r) => r.permanent);
  const recoverable = rows.filter((r) => !r.permanent);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Suppressed Leads</h1>
          <p className="text-xs text-gray-400 sm:text-sm">A dead address is not a dead lead. Only an unsubscribe blocks every channel.</p>
        </div>
        <button onClick={() => router.back()} className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">← Back</button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">No suppressed leads — your list is clean.</p>
      ) : (
        <div className="space-y-8">
          {summary && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Suppressed</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{summary.total}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Asked to stop</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{summary.permanent}</div>
                <div className="mt-0.5 text-xs text-gray-400">no channel, ever</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Callable now</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-status-ready">{summary.callable}</div>
                <div className="mt-0.5 text-xs text-gray-400">bad address, phone on file</div>
              </div>
            </div>
          )}

          <Section
            title="Email unusable — still reachable"
            blurb="The address bounced or was rejected. Nobody asked to be left alone, so these belong in the call queue."
            rows={recoverable}
            showPhone
          />
          <Section
            title="Asked not to be contacted"
            blurb="Unsubscribed or reported as spam. Excluded from every channel."
            rows={permanent}
          />
        </div>
      )}
    </div>
  );
}
