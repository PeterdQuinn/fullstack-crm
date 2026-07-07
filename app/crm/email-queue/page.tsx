"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface QueueLead {
  id: string;
  business_name: string;
  contact_name?: string | null;
  email: string;
  status: string;
  email_sent_count: number;
  emailNum: number;
  subject: string;
  bodyText: string;
  copyText: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Fallback for non-secure contexts / older browsers.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function EmailQueuePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<QueueLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchQueueLeads();
  }, []);

  async function fetchQueueLeads() {
    try {
      const response = await fetch("/api/email/queue", { cache: "no-store" });
      const data = await response.json();
      setLeads(Array.isArray(data) ? data.filter((l: QueueLead) => l.email) : []);
    } catch (error) {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(lead: QueueLead) {
    const ok = await copyToClipboard(lead.copyText);
    if (ok) {
      setCopiedId(lead.id);
      setTimeout(() => setCopiedId((c) => (c === lead.id ? null : c)), 1600);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Email Queue</h1>
          <p className="text-xs text-gray-400 sm:text-sm">Copy-paste ready — nothing sends automatically.</p>
        </div>
        <button onClick={() => router.back()} className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">← Back</button>
      </div>

      {/* Persistent manual-send-mode banner */}
      <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-900">
        <span aria-hidden>⚠️</span>
        <span>
          <strong>Manual send mode:</strong> check for STOP replies daily and mark those leads
          {" "}<strong>Do Not Contact</strong> in <a href="/crm/leads" className="underline">/crm/leads</a>.
        </span>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="text-gray-500">No leads ready to email.</p>
      ) : (
        <>
          <div className="mb-4 text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{leads.length}</span> {leads.length === 1 ? "email" : "emails"} ready to copy
          </div>

          <div className="space-y-4">
            {leads.map((lead) => (
              <div key={lead.id} className="rounded-xl border border-gray-200 bg-white p-4">
                {/* Lead header row */}
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900">{lead.business_name}</div>
                    <div className="text-sm text-gray-500 break-all">
                      {lead.contact_name ? `${lead.contact_name} · ` : ""}{lead.email}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Email #{lead.emailNum}/3
                    </span>
                    <button
                      onClick={() => handleCopy(lead)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                        copiedId === lead.id
                          ? "bg-green-600 text-white"
                          : "bg-brand text-white hover:bg-brand-dark"
                      }`}
                    >
                      {copiedId === lead.id ? "✓ Copied" : "Copy Email"}
                    </button>
                  </div>
                </div>

                {/* Rendered email: subject + body, ready to copy-paste */}
                <div className="rounded-lg border border-gray-200 bg-gray-50">
                  <div className="border-b border-gray-200 px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-500">Subject: </span>
                    <span className="text-gray-900">{lead.subject}</span>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-sans text-sm leading-relaxed text-gray-800">{lead.bodyText}</pre>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
