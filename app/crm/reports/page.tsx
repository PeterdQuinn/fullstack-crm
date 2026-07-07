"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Row {
  status: string;
  count: number;
  pct: number;
}
interface ReportData {
  range: string;
  total: number;
  breakdown: Row[];
}

type Range = "30" | "90" | "all";

const RANGE_LABELS: Record<Range, string> = {
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

// Distinct color per terminal status so the bars read at a glance.
const BAR_COLOR: Record<string, string> = {
  Won: "bg-green-500",
  Lost: "bg-red-500",
  "Do Not Contact": "bg-gray-400",
  "Bad Data": "bg-amber-500",
  "Bad Email": "bg-orange-500",
  "No Response": "bg-blue-400",
};

export default function ReportsPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>("30");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/reports?range=${r}`, { cache: "no-store" });
      setData(await res.json());
    } catch (e) {
      console.error("Error loading report:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const maxCount = data ? Math.max(1, ...data.breakdown.map((b) => b.count)) : 1;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Reports</h1>
          <p className="text-xs text-gray-400 sm:text-sm">Outcome breakdown by terminal status.</p>
        </div>
        <button onClick={() => router.back()} className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">← Back</button>
      </div>

      {/* Date range filter */}
      <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`min-h-[40px] rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              range === r ? "bg-brand text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : !data || data.total === 0 ? (
        <p className="text-gray-500">No leads in a terminal status for {RANGE_LABELS[range].toLowerCase()}.</p>
      ) : (
        <>
          <div className="mb-4 text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{data.total.toLocaleString()}</span> leads in a terminal status
          </div>

          {/* Bar chart */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            {data.breakdown.map((row) => (
              <div key={row.status} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-sm font-medium text-gray-700" title={row.status}>{row.status}</div>
                <div className="flex-1">
                  <div className="h-6 w-full overflow-hidden rounded bg-gray-100">
                    <div
                      className={`h-full rounded ${BAR_COLOR[row.status] || "bg-gray-400"}`}
                      style={{ width: `${(row.count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right text-sm tabular-nums text-gray-600">
                  <span className="font-semibold text-gray-900">{row.count}</span> · {row.pct}%
                </div>
              </div>
            ))}
          </div>

          {/* Table (same numbers, precise) */}
          <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Count</th>
                  <th className="px-4 py-3 text-right font-semibold">% of total</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.map((row) => (
                  <tr key={row.status} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.status}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{row.count}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{row.pct}%</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-900">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900">{data.total}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
