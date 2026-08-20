"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Search } from "lucide-react";

export interface DiscoveryResult {
  pipeline?: { discovered?: number; cleaned?: number; qualified?: number; newLeads?: number; imported?: number };
  searchArea?: { radiusMiles?: number; exactRadiusApplied?: boolean };
  sources?: Record<string, unknown>;
  sourceErrors?: string[];
}

const progressStages = [
  "Preparing location search",
  "Checking Google Places",
  "Checking OpenStreetMap",
  "Removing duplicates",
  "Applying quality rules",
  "Saving new businesses",
];

interface Props {
  /** Render the form open on mount (Discovery page) or collapsed (Research Center). */
  defaultOpen?: boolean;
  /** Controlled open state. When passed, the parent owns the toggle. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the collapse header entirely and always show the form. */
  collapsible?: boolean;
  /** Called when a run starts, before the first request. */
  onStart?: () => void;
  /** Called after a successful run so the parent can refresh its lead list. */
  onComplete?: (result: DiscoveryResult) => void;
  /** Called when the run fails, so the parent can surface it in its own banner. */
  onError?: (message: string) => void;
}

export default function ManualDiscoveryPanel({
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  collapsible = true,
  onStart,
  onComplete,
  onError,
}: Props) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [form, setForm] = useState({
    city: "Mesa",
    state: "AZ",
    zip: "",
    radiusMiles: 15,
    limit: 10,
    minimumRating: 0,
    minimumReviews: 0,
    requirePhone: true,
    requireEmail: false,
    requireWebsite: true,
  });

  async function run() {
    if (!form.city.trim() || !form.state.trim()) {
      setError("City and state are required");
      onError?.("City and state are required");
      return;
    }
    if (!window.confirm(`Search for up to ${form.limit} HVAC businesses in ${form.city}, ${form.state}?`)) return;

    onStart?.();
    setWorking(true);
    setError("");
    setResult(null);
    setProgress(0);
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed((value) => value + 1);
      setProgress((value) => Math.min(value + 1, progressStages.length - 1));
    }, 4000);

    try {
      const response = await fetch("/api/admin/discover-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, importToDb: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Discovery failed");
      setResult(data);
      onComplete?.(data);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Discovery failed";
      setError(message);
      onError?.(message);
    } finally {
      window.clearInterval(timer);
      setWorking(false);
      setProgress(progressStages.length - 1);
    }
  }

  const showForm = !collapsible || open;

  return (
    <div>
      {collapsible && (
        <button
          onClick={() => setOpen(!open)}
          className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 font-bold text-blue-900"
        >
          <span className="flex items-center gap-2">
            <Search size={19} />
            Manual Discovery
          </span>
          <ChevronDown className={open ? "rotate-180" : ""} size={19} />
        </button>
      )}

      {showForm && (
        <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${collapsible ? "mt-3" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="City" value={form.city} onChange={(value) => setForm({ ...form, city: value })} />
            <Input
              label="State"
              value={form.state}
              onChange={(value) => setForm({ ...form, state: value.toUpperCase().slice(0, 2) })}
            />
            <Input
              label="ZIP optional"
              value={form.zip}
              onChange={(value) => setForm({ ...form, zip: value.replace(/\D/g, "").slice(0, 5) })}
            />
            <NumberInput
              label="Search radius in miles"
              value={form.radiusMiles}
              min={1}
              max={30}
              onChange={(value) => setForm({ ...form, radiusMiles: value })}
            />
            <NumberInput
              label="Maximum businesses"
              value={form.limit}
              min={1}
              max={25}
              onChange={(value) => setForm({ ...form, limit: value })}
            />
            <NumberInput
              label="Minimum rating"
              value={form.minimumRating}
              min={0}
              max={5}
              step={0.1}
              onChange={(value) => setForm({ ...form, minimumRating: value })}
            />
            <NumberInput
              label="Minimum reviews"
              value={form.minimumReviews}
              min={0}
              max={10000}
              onChange={(value) => setForm({ ...form, minimumReviews: value })}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Check
              label="Require phone"
              checked={form.requirePhone}
              onChange={(checked) => setForm({ ...form, requirePhone: checked })}
            />
            <Check
              label="Require website"
              checked={form.requireWebsite}
              onChange={(checked) => setForm({ ...form, requireWebsite: checked })}
            />
            <Check
              label="Require email"
              checked={form.requireEmail}
              onChange={(checked) => setForm({ ...form, requireEmail: checked })}
            />
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <strong>Search summary:</strong> HVAC businesses within {form.radiusMiles} miles of {form.city},{" "}
            {form.state}
            {form.zip ? ` near ZIP ${form.zip}` : ""}. Save no more than {form.limit}. Nothing will be contacted.
          </div>

          {working && progressStages[progress] && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-blue-900">{progressStages[progress]}</span>
                <span className="text-sm text-blue-700">{elapsed} seconds</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${((progress + 1) / progressStages.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={run}
            disabled={working}
            className="mt-4 min-h-[48px] w-full rounded-lg bg-blue-700 px-5 font-bold text-white disabled:opacity-60"
          >
            {working ? "Discovery running" : "Start Manual Discovery"}
          </button>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
              {error}
            </div>
          )}

          {result && (
            <>
              <div
                className={`mt-4 rounded-lg p-3 text-sm font-semibold ${
                  result.searchArea?.exactRadiusApplied ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                }`}
              >
                {result.searchArea?.exactRadiusApplied
                  ? `Exact ${result.searchArea.radiusMiles} mile radius applied`
                  : "Coordinate lookup failed. City boundary search was used."}
              </div>
              {result.sourceErrors && result.sourceErrors.length > 0 && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle size={17} />A data source failed, so results are incomplete
                  </div>
                  <ul className="mt-2 space-y-1">
                    {result.sourceErrors.map((message) => (
                      <li key={message}>• {message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!result.pipeline?.discovered && !result.sourceErrors?.length && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                  No businesses matched this search. Try a wider radius or looser quality rules.
                </div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Metric label="Raw" value={result.pipeline?.discovered || 0} />
                <Metric label="Clean" value={result.pipeline?.cleaned || 0} />
                <Metric label="Qualified" value={result.pipeline?.qualified || 0} />
                <Metric label="New" value={result.pipeline?.newLeads || 0} />
                <Metric label="Saved" value={result.pipeline?.imported || 0} />
                <Metric
                  label="Duplicates"
                  value={Math.max(0, (result.pipeline?.qualified || 0) - (result.pipeline?.newLeads || 0))}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-blue-500"
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-blue-500"
      />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-semibold">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
