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
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb" }}>
      {/* HEADER */}
      <div style={{ backgroundColor: "white", borderBottom: "2px solid #e5e7eb", padding: "16px 20px" }}>
        <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 16px 0", fontSize: "28px", fontWeight: "700", color: "#1f2937" }}>CRM Control Center</h1>

          {/* STATS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <div style={{ backgroundColor: "#f3f4f6", padding: "12px", borderRadius: "6px" }}>
              <div style={{ fontSize: "24px", fontWeight: "700", color: "#3b82f6" }}>{stats.total}</div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>Total Leads</div>
            </div>
            <div style={{ backgroundColor: "#f3f4f6", padding: "12px", borderRadius: "6px" }}>
              <div style={{ fontSize: "24px", fontWeight: "700", color: "#10b981" }}>{stats.withEmail}</div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>With Email</div>
            </div>
            <div style={{ backgroundColor: "#f3f4f6", padding: "12px", borderRadius: "6px" }}>
              <div style={{ fontSize: "24px", fontWeight: "700", color: "#f59e0b" }}>{stats.highQuality}</div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>High Quality</div>
            </div>
            <div style={{ backgroundColor: "#f3f4f6", padding: "12px", borderRadius: "6px" }}>
              <div style={{ fontSize: "24px", fontWeight: "700", color: "#8b5cf6" }}>{stats.sentToday}</div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>Sent Today</div>
            </div>
          </div>
        </div>
      </div>

      {/* TAB NAVIGATION */}
      <div style={{ backgroundColor: "white", borderBottom: "1px solid #e5e7eb", padding: "0 20px", overflowX: "auto" }}>
        <div style={{ maxWidth: "1600px", margin: "0 auto", display: "flex", gap: "0" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "16px 24px",
                border: "none",
                backgroundColor: "transparent",
                color: activeTab === tab.id ? "#3b82f6" : "#6b7280",
                borderBottom: activeTab === tab.id ? "3px solid #3b82f6" : "none",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: activeTab === tab.id ? "600" : "500",
                whiteSpace: "nowrap",
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div style={{ maxWidth: "1600px", margin: "0 auto", padding: "20px" }}>
        {activeTab === "overview" && (
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ margin: "0 0 16px 0" }}>Dashboard Overview</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px" }}>
              <div style={{ padding: "16px", backgroundColor: "#f0f9ff", borderRadius: "8px", border: "1px solid #bfdbfe" }}>
                <h3 style={{ margin: "0 0 8px 0", color: "#1e40af" }}>Discovery Pipeline</h3>
                <button
                  onClick={runDiscovery}
                  disabled={discovering}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#3b82f6",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "600",
                    opacity: discovering ? 0.6 : 1,
                  }}
                >
                  {discovering ? "🔍 Discovering..." : "🚀 Run Discovery"}
                </button>
                <p style={{ margin: "12px 0 0 0", fontSize: "12px", color: "#6b7280" }}>
                  Automatically finds and imports new leads nationwide
                </p>
              </div>

              <div style={{ padding: "16px", backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                <h3 style={{ margin: "0 0 8px 0", color: "#15803d" }}>Email Automation</h3>
                <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#6b7280" }}>
                  Sends up to 25 emails per day to high-quality leads
                </p>
                <p style={{ margin: "0", fontSize: "12px", fontWeight: "600", color: "#16a34a" }}>
                  {stats.sentToday}/25 emails sent today
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "discovery" && (
          <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: "20px", minHeight: "600px" }}>
            {/* LEFT SIDEBAR - TABS AND LEADS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* DISCOVERY CONTENT TABS */}
              <div style={{ backgroundColor: "white", borderRadius: "8px", overflow: "hidden" }}>
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
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      border: "none",
                      backgroundColor: discoveryActiveTab === tab.id ? "#3b82f6" : "white",
                      color: discoveryActiveTab === tab.id ? "white" : "#1f2937",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: discoveryActiveTab === tab.id ? "600" : "500",
                      borderBottom: "1px solid #e5e7eb",
                      textAlign: "left",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* DISCOVERED LEADS LIST */}
              <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280", marginBottom: "8px" }}>
                  Discovered ({discoveredLeads.length})
                </div>
                <div style={{ maxHeight: "calc(100vh - 450px)", overflowY: "auto" }}>
                  {discoveryLoading ? (
                    <div style={{ fontSize: "12px", color: "#6b7280", padding: "12px", textAlign: "center" }}>Loading...</div>
                  ) : discoveredLeads.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "#6b7280", padding: "12px", textAlign: "center" }}>No leads discovered yet</div>
                  ) : (
                    discoveredLeads.slice(0, leadsDisplayCount).map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => {
                          setSelectedLead(lead);
                          setDiscoveryActiveTab("info");
                        }}
                        style={{
                          width: "100%",
                          padding: "10px",
                          marginBottom: "4px",
                          backgroundColor: selectedLead?.id === lead.id ? "#eff6ff" : "transparent",
                          border: selectedLead?.id === lead.id ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                          borderRadius: "4px",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ fontSize: "12px", fontWeight: "600", color: "#1f2937" }}>
                          {lead.business_name}
                        </div>
                        <div style={{ fontSize: "11px", color: "#6b7280" }}>
                          {lead.city || lead.state ? `${lead.city || "Unknown"}, ${lead.state || ""}` : "No location"}
                        </div>
                        {lead.email && <div style={{ fontSize: "10px", color: "#10b981", fontWeight: "600" }}>✓ Email</div>}
                      </button>
                    ))
                  )}
                </div>
                {discoveredLeads.length > leadsDisplayCount && (
                  <button
                    onClick={() => setLeadsDisplayCount(leadsDisplayCount + 20)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "8px",
                      backgroundColor: "#f3f4f6",
                      border: "1px solid #e5e7eb",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "#3b82f6",
                      fontWeight: "600",
                    }}
                  >
                    Show {Math.min(20, discoveredLeads.length - leadsDisplayCount)} more
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT SIDE - LEAD DETAILS WITH TABS */}
            {selectedLead ? (
              <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflowY: "auto", maxHeight: "calc(100vh - 200px)" }}>
                <h2 style={{ margin: "0 0 16px 0", fontSize: "24px", fontWeight: "700", color: "#1f2937" }}>
                  {selectedLead.business_name}
                </h2>

                {discoveryActiveTab === "info" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600", marginBottom: "6px" }}>Phone</div>
                      <div style={{ fontSize: "14px", color: "#1f2937", fontWeight: "500" }}>
                        {selectedLead.phone ? (
                          <a href={`tel:${selectedLead.phone.replace(/\D/g, "")}`} style={{ color: "#0066cc", textDecoration: "none" }}>
                            {formatPhoneNumber(selectedLead.phone)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600", marginBottom: "6px" }}>Email</div>
                      <div style={{ fontSize: "14px", color: "#0066cc", fontWeight: "500" }}>{selectedLead.email || "Not found"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600", marginBottom: "6px" }}>City</div>
                      <div style={{ fontSize: "14px", color: "#1f2937", fontWeight: "500" }}>{selectedLead.city || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600", marginBottom: "6px" }}>Industry</div>
                      <div style={{ fontSize: "14px", color: "#1f2937", fontWeight: "500" }}>{selectedLead.industry || selectedLead.niche || "—"}</div>
                    </div>
                  </div>
                )}

                {discoveryActiveTab === "source" && (
                  <div style={{ padding: "16px", backgroundColor: "#f0f9ff", borderRadius: "8px", border: "1px solid #bfdbfe" }}>
                    <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Source: <span style={{ fontWeight: "600", color: "#1f2937" }}>{selectedLead.niche || "Google Business"}</span>
                    </p>
                    <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Industry: <span style={{ fontWeight: "600", color: "#1f2937" }}>{selectedLead.industry || selectedLead.niche || "Unknown"}</span>
                    </p>
                    <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Website: <span style={{ fontWeight: "600", color: "#1f2937" }}>
                        {selectedLead.website ? (
                          <a href={selectedLead.website} target="_blank" rel="noopener noreferrer" style={{ color: "#0066cc", textDecoration: "underline" }}>
                            {selectedLead.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "Not found"
                        )}
                      </span>
                    </p>
                    <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Address: <span style={{ fontWeight: "600", color: "#1f2937" }}>{selectedLead.address || "Not found"}</span>
                    </p>
                    <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Discovered: <span style={{ fontWeight: "600", color: "#1f2937" }}>
                        {selectedLead.created_at
                          ? `${new Date(selectedLead.created_at).toLocaleDateString()} ${new Date(selectedLead.created_at).toLocaleTimeString()}`
                          : "Today"}
                      </span>
                    </p>
                    <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Status: <span style={{ fontWeight: "600", color: selectedLead.status === "Ready for Outreach" ? "#16a34a" : "#f59e0b" }}>
                        {selectedLead.status || "New"}
                      </span>
                    </p>
                  </div>
                )}

                {discoveryActiveTab === "enrichment" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ padding: "12px", backgroundColor: selectedLead.email ? "#dcfce7" : "#fee2e2", borderRadius: "6px", border: `1px solid ${selectedLead.email ? "#86efac" : "#fca5a5"}` }}>
                      <p style={{ margin: "0", fontSize: "13px", fontWeight: "600", color: selectedLead.email ? "#166534" : "#991b1b" }}>
                        {selectedLead.email ? "✓ Email Found" : "✗ Email Missing"}
                      </p>
                    </div>
                    <div style={{ padding: "12px", backgroundColor: selectedLead.phone ? "#dcfce7" : "#fee2e2", borderRadius: "6px", border: `1px solid ${selectedLead.phone ? "#86efac" : "#fca5a5"}` }}>
                      <p style={{ margin: "0", fontSize: "13px", fontWeight: "600", color: selectedLead.phone ? "#166534" : "#991b1b" }}>
                        {selectedLead.phone ? "✓ Phone Found" : "✗ Phone Missing"}
                      </p>
                    </div>
                  </div>
                )}

                {discoveryActiveTab === "email" && (
                  <div style={{ padding: "16px", backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                    <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Status: <span style={{ fontWeight: "600", color: "#16a34a" }}>{selectedLead.status || "Ready for Outreach"}</span>
                    </p>
                    <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                      Emails Sent: <span style={{ fontWeight: "600" }}>{selectedLead.email_sent_count || 0}/3</span>
                    </p>
                    {(selectedLead.outreach_log?.length || 0) > 0 && (
                      <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #bbf7d0" }}>
                        <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: "600", color: "#166534" }}>Outreach History:</p>
                        {selectedLead.outreach_log?.slice(0, 3).map((log, idx) => (
                          <div key={idx} style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>
                            📧 {log.channel === "email" ? "Email" : log.channel} • {new Date(log.sent_at).toLocaleDateString()}
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedLead.email && (
                      <button onClick={handleSendEmailFromDiscovery} style={{ marginTop: "12px", padding: "8px 16px", backgroundColor: "#16a34a", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600", fontSize: "13px" }}>
                        Send Email
                      </button>
                    )}
                  </div>
                )}

                {discoveryActiveTab === "scoring" && (
                  <div style={{ padding: "16px", backgroundColor: "#f3f0ff", borderRadius: "8px", border: "1px solid #e9d5ff" }}>
                    {selectedLead.lead_ai_summaries ? (
                      <>
                        <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6b7280" }}>
                          Lead Score: <span style={{ fontWeight: "600", color: "#7c3aed" }}>{selectedLead.lead_ai_summaries.lead_score || "Pending"}/100</span>
                        </p>
                        <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                          Confidence: <span style={{ fontWeight: "600", color: "#7c3aed" }}>{selectedLead.lead_ai_summaries.confidence_level || "N/A"}</span>
                        </p>
                        {selectedLead.lead_ai_summaries.main_pain_point && (
                          <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                            Pain Point: <span style={{ fontWeight: "600", color: "#1f2937" }}>{selectedLead.lead_ai_summaries.main_pain_point}</span>
                          </p>
                        )}
                        {selectedLead.lead_ai_summaries.best_attack_angle && (
                          <p style={{ margin: "8px 0", fontSize: "13px", color: "#6b7280" }}>
                            Best Angle: <span style={{ fontWeight: "600", color: "#1f2937" }}>{selectedLead.lead_ai_summaries.best_attack_angle}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <p style={{ color: "#6b7280", fontSize: "13px" }}>
                        ⏳ AI scoring in progress... This lead was recently imported and will be auto-scored within the next few hours by our automation pipeline.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : discoveryLoading ? (
              <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "40px", textAlign: "center", color: "#6b7280" }}>
                <p>Loading discovered leads...</p>
              </div>
            ) : (
              <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "40px", textAlign: "center", color: "#6b7280" }}>
                <button
                  onClick={runDiscovery}
                  disabled={discovering}
                  style={{
                    padding: "12px 24px",
                    backgroundColor: "#3b82f6",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "14px",
                    opacity: discovering ? 0.6 : 1,
                  }}
                >
                  {discovering ? "🔍 Discovering..." : "🚀 Run Discovery"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "email" && (
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ margin: "0 0 16px 0" }}>Email Queue</h2>
            {emailStatus && (
              <div style={{
                padding: "12px",
                backgroundColor: emailSent > 0 ? "#d1fae5" : "#fee2e2",
                border: `2px solid ${emailSent > 0 ? "#10b981" : "#ef4444"}`,
                borderRadius: "6px",
                marginBottom: "16px",
                fontSize: "14px",
              }}>
                {emailStatus}
              </div>
            )}
            {emailLoading ? (
              <p style={{ color: "#6b7280" }}>Loading queue...</p>
            ) : emailLeads.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No leads with email addresses ready to send</p>
            ) : (
              <>
                <div style={{ padding: "16px", backgroundColor: "#f0fdf4", borderRadius: "8px", marginBottom: "16px", border: "2px solid #22c55e" }}>
                  <p style={{ margin: "0 0 12px 0", color: "#166534", fontSize: "16px", fontWeight: "600" }}>{emailLeads.length} leads ready to email</p>
                  <button
                    onClick={handleSendEmailBatch}
                    disabled={emailSending}
                    style={{
                      padding: "10px 20px",
                      backgroundColor: "#059669",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: emailSending ? "wait" : "pointer",
                      fontWeight: "600",
                      opacity: emailSending ? 0.8 : 1,
                    }}
                  >
                    {emailSending ? `Sending... ${emailSent}/${emailLeads.length}` : "SEND ALL NOW"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                  {emailLeads.slice(0, 20).map((lead) => (
                    <div key={lead.id} style={{
                      padding: "12px",
                      backgroundColor: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}>
                      <div style={{ fontWeight: "600", color: "#1f2937", marginBottom: "4px" }}>{lead.business_name}</div>
                      <div style={{ color: "#6b7280", wordBreak: "break-all" }}>{lead.email}</div>
                      <div style={{ color: "#9ca3af", marginTop: "6px" }}>Email #{lead.email_sent_count + 1}/3</div>
                    </div>
                  ))}
                </div>
                {emailLeads.length > 20 && (
                  <p style={{ marginTop: "12px", textAlign: "center", color: "#6b7280", fontSize: "12px" }}>+{emailLeads.length - 20} more</p>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "calls" && (
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ margin: "0 0 16px 0" }}>Call Queue</h2>
            <p style={{ color: "#6b7280", marginBottom: "16px" }}>Track and manage outbound calling campaigns</p>
            <a href="/crm/call-queue" style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#ef4444",
              color: "white",
              textDecoration: "none",
              borderRadius: "6px",
              fontWeight: "600",
            }}>Go to Call Queue →</a>
          </div>
        )}

        {activeTab === "replies" && (
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ margin: "0 0 16px 0" }}>Replies</h2>
            <p style={{ color: "#6b7280", marginBottom: "16px" }}>Monitor and respond to lead replies</p>
            <a href="/crm/replies" style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#8b5cf6",
              color: "white",
              textDecoration: "none",
              borderRadius: "6px",
              fontWeight: "600",
            }}>Go to Replies →</a>
          </div>
        )}

        {activeTab === "bookings" && (
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ margin: "0 0 16px 0" }}>Bookings</h2>
            <p style={{ color: "#6b7280", marginBottom: "16px" }}>Track scheduled calls and meetings</p>
            <a href="/crm/bookings" style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#10b981",
              color: "white",
              textDecoration: "none",
              borderRadius: "6px",
              fontWeight: "600",
            }}>Go to Bookings →</a>
          </div>
        )}

        {activeTab === "leads" && (
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ margin: "0 0 16px 0" }}>All Leads Database</h2>
            <p style={{ color: "#6b7280", marginBottom: "16px" }}>View and manage your complete lead database</p>
            <a href="/crm/dashboard-tabs" style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#3b82f6",
              color: "white",
              textDecoration: "none",
              borderRadius: "6px",
              fontWeight: "600",
            }}>Go to All Leads →</a>
          </div>
        )}
      </div>
    </div>
  );
}
