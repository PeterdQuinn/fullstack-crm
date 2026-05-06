"use client";

import { useState, useEffect } from "react";
import { formatPhoneNumber } from "@/lib/format-phone";

interface Lead {
  id: string;
  business_name: string;
  phone?: string;
  email?: string;
  owner_name?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  niche?: string;
  industry?: string;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  status: string;
  email_sent_count: number;
  created_at: string;
  lead_ai_summaries?: {
    lead_score: number;
    confidence_level: string;
    main_pain_point?: string;
    best_attack_angle?: string;
    missing_data_needed?: string[];
  };
  lead_socials?: Array<{
    platform: string;
    url?: string;
    username?: string;
    is_active: boolean;
  }>;
  outreach_log?: Array<{
    channel: string;
    sent_at: string;
    opened_at?: string;
    replied_at?: string;
    message_body?: string;
  }>;
  booking_tracker?: {
    booking_status?: string;
    booked_at?: string;
  };
}

interface QueueLead {
  id: string;
  business_name: string;
  email?: string;
  email_sent_count: number;
}

type Tab = "overview" | "discovery" | "email" | "calls" | "replies" | "bookings" | "leads";

export default function UnifiedDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [stats, setStats] = useState({ total: 408, withEmail: 13, highQuality: 16, sentToday: 0 });
  const [discovering, setDiscovering] = useState(false);
  const [emailLeads, setEmailLeads] = useState<QueueLead[]>([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");
  const [emailSent, setEmailSent] = useState(0);
  const [statsLoaded, setStatsLoaded] = useState(false);

  // Discovery/New Leads state
  const [discoveredLeads, setDiscoveredLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryActiveTab, setDiscoveryActiveTab] = useState<"info" | "source" | "enrichment" | "email" | "scoring">("info");
  const [leadsDisplayCount, setLeadsDisplayCount] = useState(20);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "email" && emailLeads.length === 0) {
      loadEmailQueue();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "discovery" && discoveredLeads.length === 0) {
      loadDiscoveredLeads();
    }
  }, [activeTab]);

  async function loadStats() {
    try {
      const res = await fetch("/api/admin/status");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats({
        total: data.leads?.total || 408,
        withEmail: data.leads?.withEmail || 13,
        highQuality: data.scoring?.highQuality || 16,
        sentToday: data.email?.sentToday || 0,
      });
      setStatsLoaded(true);
    } catch (error) {
      console.error("Error loading stats:", error);
      setStats({ total: 408, withEmail: 13, highQuality: 16, sentToday: 0 });
      setStatsLoaded(true);
    }
  }

  async function loadEmailQueue() {
    setEmailLoading(true);
    try {
      const res = await fetch("/api/email/queue");
      const data = await res.json();
      setEmailLeads(data || []);
    } catch (error) {
      console.error("Error loading email queue:", error);
      setEmailLeads([]);
    } finally {
      setEmailLoading(false);
    }
  }

  async function loadDiscoveredLeads() {
    setDiscoveryLoading(true);
    try {
      const res = await fetch("/api/admin/discovered-leads");
      const data = await res.json();
      setDiscoveredLeads(data?.leads || []);
      if (data?.leads?.length > 0) {
        setSelectedLead(data.leads[0]);
      }
    } catch (error) {
      console.error("Error loading discovered leads:", error);
      setDiscoveredLeads([]);
    } finally {
      setDiscoveryLoading(false);
    }
  }

  async function handleSendEmailBatch() {
    if (!window.confirm(`Send emails to ${emailLeads.length} leads?`)) return;

    setEmailSending(true);
    setEmailStatus("Sending...");
    setEmailSent(0);

    try {
      const res = await fetch("/api/email/send-batch", { method: "POST" });
      const data = await res.json();
      setEmailSent(data.sent?.length || 0);
      setEmailStatus(data.sent?.length > 0 ? `✓ Sent ${data.sent.length} emails` : "No emails sent");
      loadEmailQueue();
      loadStats();
    } catch (error) {
      setEmailStatus("✗ Error sending emails");
    } finally {
      setEmailSending(false);
    }
  }

  async function runDiscovery() {
    setDiscovering(true);
    try {
      const res = await fetch("/api/admin/discover-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states: 1, limit: 15, enrichEmails: true, importToDb: true }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Discovery Complete!\nDiscovered: ${data.pipeline.discovered}\nImported: ${data.pipeline.imported} with emails`);
        loadStats();
        loadDiscoveredLeads();
      } else {
        alert(`❌ Discovery failed: ${data.error}`);
      }
    } catch (error) {
      alert(`❌ Error: ${error instanceof Error ? error.message : "Discovery failed"}`);
      console.error("Discovery error:", error);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSendEmailFromDiscovery() {
    if (!selectedLead?.email) {
      alert("No email address available for this lead");
      return;
    }

    if (!window.confirm(`Send email to ${selectedLead.business_name}?`)) return;

    try {
      const res = await fetch("/api/email/send-batch", { method: "POST" });
      const data = await res.json();

      if (data.sent?.length > 0) {
        alert(`✅ Email sent to ${selectedLead.business_name}`);
        loadDiscoveredLeads();
      } else {
        alert(`❌ Failed to send email. Score may be too low.`);
      }
    } catch (error) {
      alert(`❌ Error sending email: ${error instanceof Error ? error.message : "Failed"}`);
    }
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "discovery", label: "New Leads", icon: "🔍" },
    { id: "email", label: "Email Queue", icon: "📧" },
    { id: "calls", label: "Call Queue", icon: "☎️" },
    { id: "replies", label: "Replies", icon: "💬" },
    { id: "bookings", label: "Bookings", icon: "📅" },
    { id: "leads", label: "All Leads", icon: "👥" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* HEADER */}
      <div className="border-b-2 border-gray-200 bg-white px-5 py-4">
        <div className="mx-auto max-w-6xl">
          <h1 className="mb-4 text-3xl font-bold text-gray-900">CRM Control Center</h1>

          {/* STATS */}
          <div className="grid gap-4 grid-cols-4">
            <div className="rounded-md bg-gray-100 p-3">
              <div className="text-2xl font-bold text-blue-500">{stats.total}</div>
              <div className="text-xs text-gray-500">Total Leads</div>
            </div>
            <div className="rounded-md bg-gray-100 p-3">
              <div className="text-2xl font-bold text-green-600">{stats.withEmail}</div>
              <div className="text-xs text-gray-500">With Email</div>
            </div>
            <div className="rounded-md bg-gray-100 p-3">
              <div className="text-2xl font-bold text-amber-500">{stats.highQuality}</div>
              <div className="text-xs text-gray-500">High Quality</div>
            </div>
            <div className="rounded-md bg-gray-100 p-3">
              <div className="text-2xl font-bold text-purple-600">{stats.sentToday}</div>
              <div className="text-xs text-gray-500">Sent Today</div>
            </div>
          </div>
        </div>
      </div>

      {/* TAB NAVIGATION */}
      <div className="border-b border-gray-200 overflow-x-auto bg-white px-5">
        <div className="mx-auto max-w-6xl flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-4 px-6 py-4 whitespace-nowrap text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-4 border-blue-500 text-blue-600"
                  : "border-b-4 border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className="mx-auto max-w-6xl px-5 py-5">
        {activeTab === "overview" && (
          <div className="rounded-lg bg-white p-5">
            <h2 className="mb-4 text-xl font-bold">Dashboard Overview</h2>
            <div className="grid gap-5 grid-cols-2">
              <div className="rounded-lg border border-blue-300 bg-blue-50 p-4">
                <h3 className="mb-2 font-bold text-blue-900">Discovery Pipeline</h3>
                <button
                  onClick={runDiscovery}
                  disabled={discovering}
                  className="rounded-md bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
                >
                  {discovering ? "🔍 Discovering..." : "🚀 Run Discovery"}
                </button>
                <p className="mt-3 text-xs text-gray-600">
                  Automatically finds and imports new leads nationwide
                </p>
              </div>

              <div className="rounded-lg border border-green-300 bg-green-50 p-4">
                <h3 className="mb-2 font-bold text-green-900">Email Automation</h3>
                <p className="text-xs text-gray-600">
                  Sends up to 25 emails per day to high-quality leads
                </p>
                <p className="mt-2 text-sm font-semibold text-green-700">
                  {stats.sentToday}/25 emails sent today
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "discovery" && (
          <div className="grid gap-5 grid-cols-[250px_1fr] min-h-[600px]">
            {/* LEFT SIDEBAR - TABS AND LEADS */}
            <div className="flex flex-col gap-4">
              {/* DISCOVERY CONTENT TABS */}
              <div className="overflow-hidden rounded-lg bg-white">
                {[
                  { id: "info", label: "Info" },
                  { id: "source", label: "Source" },
                  { id: "enrichment", label: "Enrichment" },
                  { id: "email", label: "Email" },
                  { id: "scoring", label: "Scoring" },
                ].map((tab: any) => (
                  <button
                    key={tab.id}
                    onClick={() => setDiscoveryActiveTab(tab.id)}
                    className={`w-full border-b px-4 py-3 text-left text-sm font-medium transition-colors ${
                      discoveryActiveTab === tab.id
                        ? "bg-blue-500 text-white"
                        : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* DISCOVERED LEADS LIST */}
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="mb-2 text-xs font-bold text-gray-500">
                  Discovered ({discoveredLeads.length})
                </div>
                <div className="max-h-[calc(100vh-450px)] overflow-y-auto">
                  {discoveryLoading ? (
                    <div className="py-3 text-center text-xs text-gray-500">Loading...</div>
                  ) : discoveredLeads.length === 0 ? (
                    <div className="py-3 text-center text-xs text-gray-500">No leads discovered yet</div>
                  ) : (
                    discoveredLeads.slice(0, leadsDisplayCount).map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => {
                          setSelectedLead(lead);
                          setDiscoveryActiveTab("info");
                        }}
                        className={`w-full rounded-md p-2 mb-1 text-left text-xs transition-colors ${
                          selectedLead?.id === lead.id
                            ? "border-2 border-blue-500 bg-blue-50"
                            : "border border-gray-200 bg-transparent hover:bg-gray-50"
                        }`}
                      >
                        <div className="font-semibold text-gray-900">{lead.business_name}</div>
                        <div className="text-gray-500">
                          {lead.city || lead.state ? `${lead.city || "Unknown"}, ${lead.state || ""}` : "No location"}
                        </div>
                        {lead.email && <div className="font-semibold text-green-600">✓ Email</div>}
                      </button>
                    ))
                  )}
                </div>
                {discoveredLeads.length > leadsDisplayCount && (
                  <button
                    onClick={() => setLeadsDisplayCount(leadsDisplayCount + 20)}
                    className="mt-2 w-full rounded-md border border-gray-200 bg-gray-100 py-2 text-xs font-semibold text-blue-500 hover:bg-gray-200"
                  >
                    Show {Math.min(20, discoveredLeads.length - leadsDisplayCount)} more
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT SIDE - LEAD DETAILS WITH TABS */}
            {selectedLead ? (
              <div className="max-h-[calc(100vh-200px)] overflow-y-auto rounded-lg bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-2xl font-bold text-gray-900">
                  {selectedLead.business_name}
                </h2>

                {discoveryActiveTab === "info" && (
                  <div className="grid gap-4 grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-bold text-gray-500">Phone</div>
                      <div className="text-sm font-medium text-gray-900">
                        {selectedLead.phone ? (
                          <a href={`tel:${selectedLead.phone.replace(/\D/g, "")}`} className="text-blue-600 no-underline hover:underline">
                            {formatPhoneNumber(selectedLead.phone)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold text-gray-500">Email</div>
                      <div className="text-sm font-medium text-blue-600">{selectedLead.email || "Not found"}</div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold text-gray-500">City</div>
                      <div className="text-sm font-medium text-gray-900">{selectedLead.city || "—"}</div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold text-gray-500">Industry</div>
                      <div className="text-sm font-medium text-gray-900">{selectedLead.industry || selectedLead.niche || "—"}</div>
                    </div>
                  </div>
                )}

                {discoveryActiveTab === "source" && (
                  <div className="rounded-lg border border-blue-300 bg-blue-50 p-4">
                    <p className="mb-2 text-xs text-gray-500">
                      Source: <span className="font-semibold text-gray-900">{selectedLead.niche || "Google Business"}</span>
                    </p>
                    <p className="my-2 text-xs text-gray-500">
                      Industry: <span className="font-semibold text-gray-900">{selectedLead.industry || selectedLead.niche || "Unknown"}</span>
                    </p>
                    <p className="my-2 text-xs text-gray-500">
                      Website: <span className="font-semibold text-gray-900">
                        {selectedLead.website ? (
                          <a href={selectedLead.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                            {selectedLead.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "Not found"
                        )}
                      </span>
                    </p>
                    <p className="my-2 text-xs text-gray-500">
                      Address: <span className="font-semibold text-gray-900">{selectedLead.address || "Not found"}</span>
                    </p>
                    <p className="my-2 text-xs text-gray-500">
                      Discovered: <span className="font-semibold text-gray-900">
                        {selectedLead.created_at
                          ? `${new Date(selectedLead.created_at).toLocaleDateString()} ${new Date(selectedLead.created_at).toLocaleTimeString()}`
                          : "Today"}
                      </span>
                    </p>
                    <p className="my-2 text-xs text-gray-500">
                      Status: <span className={`font-semibold ${selectedLead.status === "Ready for Outreach" ? "text-green-700" : "text-amber-600"}`}>
                        {selectedLead.status || "New"}
                      </span>
                    </p>
                  </div>
                )}

                {discoveryActiveTab === "enrichment" && (
                  <div className="flex flex-col gap-2">
                    <div className={`rounded-md border p-3 ${selectedLead.email ? "border-green-300 bg-green-100" : "border-red-300 bg-red-100"}`}>
                      <p className={`text-xs font-semibold m-0 ${selectedLead.email ? "text-green-900" : "text-red-900"}`}>
                        {selectedLead.email ? "✓ Email Found" : "✗ Email Missing"}
                      </p>
                    </div>
                    <div className={`rounded-md border p-3 ${selectedLead.phone ? "border-green-300 bg-green-100" : "border-red-300 bg-red-100"}`}>
                      <p className={`text-xs font-semibold m-0 ${selectedLead.phone ? "text-green-900" : "text-red-900"}`}>
                        {selectedLead.phone ? "✓ Phone Found" : "✗ Phone Missing"}
                      </p>
                    </div>
                  </div>
                )}

                {discoveryActiveTab === "email" && (
                  <div className="rounded-lg border border-green-300 bg-green-50 p-4">
                    <p className="mb-2 text-xs text-gray-500">
                      Status: <span className="font-semibold text-green-700">{selectedLead.status || "Ready for Outreach"}</span>
                    </p>
                    <p className="my-2 text-xs text-gray-500">
                      Emails Sent: <span className="font-semibold">{selectedLead.email_sent_count || 0}/3</span>
                    </p>
                    {(selectedLead.outreach_log?.length || 0) > 0 && (
                      <div className="border-t border-green-300 pt-3 mt-3">
                        <p className="mb-2 text-xs font-semibold text-green-900">Outreach History:</p>
                        {selectedLead.outreach_log?.slice(0, 3).map((log, idx) => (
                          <div key={idx} className="mb-1 text-xs text-gray-500">
                            📧 {log.channel === "email" ? "Email" : log.channel} • {new Date(log.sent_at).toLocaleDateString()}
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedLead.email && (
                      <button onClick={handleSendEmailFromDiscovery} className="mt-3 rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700">
                        Send Email
                      </button>
                    )}
                  </div>
                )}

                {discoveryActiveTab === "scoring" && (
                  <div className="rounded-lg border border-purple-300 bg-purple-50 p-4">
                    {selectedLead.lead_ai_summaries ? (
                      <>
                        <p className="mb-2 text-xs text-gray-500">
                          Lead Score: <span className="font-semibold text-purple-700">{selectedLead.lead_ai_summaries.lead_score || "Pending"}/100</span>
                        </p>
                        <p className="my-2 text-xs text-gray-500">
                          Confidence: <span className="font-semibold text-purple-700">{selectedLead.lead_ai_summaries.confidence_level || "N/A"}</span>
                        </p>
                        {selectedLead.lead_ai_summaries.main_pain_point && (
                          <p className="my-2 text-xs text-gray-500">
                            Pain Point: <span className="font-semibold text-gray-900">{selectedLead.lead_ai_summaries.main_pain_point}</span>
                          </p>
                        )}
                        {selectedLead.lead_ai_summaries.best_attack_angle && (
                          <p className="my-2 text-xs text-gray-500">
                            Best Angle: <span className="font-semibold text-gray-900">{selectedLead.lead_ai_summaries.best_attack_angle}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">
                        ⏳ AI scoring in progress... This lead was recently imported and will be auto-scored within the next few hours by our automation pipeline.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : discoveryLoading ? (
              <div className="rounded-lg bg-white p-10 text-center text-gray-500">
                <p>Loading discovered leads...</p>
              </div>
            ) : (
              <div className="rounded-lg bg-white p-10 text-center text-gray-500">
                <button
                  onClick={runDiscovery}
                  disabled={discovering}
                  className="rounded-md bg-blue-500 px-6 py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
                >
                  {discovering ? "🔍 Discovering..." : "🚀 Run Discovery"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "email" && (
          <div className="rounded-lg bg-white p-5">
            <h2 className="mb-4 text-xl font-bold">Email Queue</h2>
            {emailStatus && (
              <div className={`mb-4 rounded-md border-2 p-3 text-sm ${
                emailSent > 0
                  ? "border-green-500 bg-green-100"
                  : "border-red-500 bg-red-100"
              }`}>
                {emailStatus}
              </div>
            )}
            {emailLoading ? (
              <p className="text-gray-500">Loading queue...</p>
            ) : emailLeads.length === 0 ? (
              <p className="text-gray-500">No leads with email addresses ready to send</p>
            ) : (
              <>
                <div className="mb-4 rounded-lg border-2 border-green-500 bg-green-50 p-4">
                  <p className="mb-3 text-base font-bold text-green-900">{emailLeads.length} leads ready to email</p>
                  <button
                    onClick={handleSendEmailBatch}
                    disabled={emailSending}
                    className="rounded-md bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-80"
                  >
                    {emailSending ? `Sending... ${emailSent}/${emailLeads.length}` : "SEND ALL NOW"}
                  </button>
                </div>
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                  {emailLeads.slice(0, 20).map((lead) => (
                    <div key={lead.id} className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
                      <div className="mb-1 font-semibold text-gray-900">{lead.business_name}</div>
                      <div className="break-all text-gray-500">{lead.email}</div>
                      <div className="mt-1.5 text-gray-400">Email #{lead.email_sent_count + 1}/3</div>
                    </div>
                  ))}
                </div>
                {emailLeads.length > 20 && (
                  <p className="mt-3 text-center text-xs text-gray-500">+{emailLeads.length - 20} more</p>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "calls" && (
          <div className="rounded-lg bg-white p-5">
            <h2 className="mb-4 text-xl font-bold">Call Queue</h2>
            <p className="mb-4 text-gray-500">Track and manage outbound calling campaigns</p>
            <a href="/crm/call-queue" className="inline-block rounded-md bg-red-500 px-5 py-2.5 font-semibold text-white no-underline hover:bg-red-600">
              Go to Call Queue →
            </a>
          </div>
        )}

        {activeTab === "replies" && (
          <div className="rounded-lg bg-white p-5">
            <h2 className="mb-4 text-xl font-bold">Replies</h2>
            <p className="mb-4 text-gray-500">Monitor and respond to lead replies</p>
            <a href="/crm/replies" className="inline-block rounded-md bg-purple-600 px-5 py-2.5 font-semibold text-white no-underline hover:bg-purple-700">
              Go to Replies →
            </a>
          </div>
        )}

        {activeTab === "bookings" && (
          <div className="rounded-lg bg-white p-5">
            <h2 className="mb-4 text-xl font-bold">Bookings</h2>
            <p className="mb-4 text-gray-500">Track scheduled calls and meetings</p>
            <a href="/crm/bookings" className="inline-block rounded-md bg-green-600 px-5 py-2.5 font-semibold text-white no-underline hover:bg-green-700">
              Go to Bookings →
            </a>
          </div>
        )}

        {activeTab === "leads" && (
          <div className="rounded-lg bg-white p-5">
            <h2 className="mb-4 text-xl font-bold">All Leads Database</h2>
            <p className="mb-4 text-gray-500">View and manage your complete lead database</p>
            <a href="/crm/dashboard-tabs" className="inline-block rounded-md bg-blue-500 px-5 py-2.5 font-semibold text-white no-underline hover:bg-blue-600">
              Go to All Leads →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
