"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SuppressedLead {
  id: string;
  company: string;
  contact?: string | null;
  email?: string | null;
  reasons: string[];
  date_flagged?: string | null;
  original_status?: string | null;
  current_status?: string | null;
}

const REASON_STYLE: Record<string, string> = {
  bounced: "bg-orange-100 text-orange-700",
  complained: "bg-red-100 text-red-700",
  opt_out: "bg-gray-200 text-gray-700",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SuppressedPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SuppressedLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/crm/suppressed", { cache: "no-store" });
        setRows(await res.json());
      } catch (e) {
        console.error("Error loading suppressed leads:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Suppressed Leads</h1>
          <p className="text-xs text-gray-400 sm:text-sm">Bounced, complained, or unsubscribed — excluded from all outreach.</p>
        </div>
        <button onClick={() => router.back()} className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">← Back</button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">No suppressed leads — your list is clean.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Reason</th>
                <th className="px-4 py-3 font-semibold">Date flagged</th>
                <th className="px-4 py-3 font-semibold">Status before</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.company}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.contact || r.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {r.reasons.map((reason) => (
                        <span key={reason} className={`rounded-full px-2 py-0.5 text-xs font-medium ${REASON_STYLE[reason] || "bg-gray-100 text-gray-600"}`}>
                          {reason}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(r.date_flagged)}</td>
                  <td className="px-4 py-3 text-gray-600">{r.original_status || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/crm/leads" className="text-sm font-medium text-brand hover:underline">View lead</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
