"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface QueueLead {
  id: string;
  business_name: string;
  email?: string;
  email_sent_count: number;
}

export default function EmailQueuePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<QueueLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    fetchQueueLeads();
  }, []);

  async function fetchQueueLeads() {
    try {
      const response = await fetch("/api/email/queue");
      const data = await response.json();
      setLeads(data?.filter((l: QueueLead) => l.email) || []);
    } catch (error) {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendBatch() {
    if (!window.confirm(`Send emails to ${leads.length} leads?`)) return;

    setSending(true);
    setStatus("Sending...");
    setSent(0);
    setFailed(0);

    try {
      const response = await fetch("/api/email/send-batch", { method: "POST" });
      const data = await response.json();

      setSent(data.sent?.length || 0);
      setFailed(data.failed?.length || 0);
      setStatus(
        data.sent?.length > 0
          ? `✓ Sent ${data.sent.length} emails`
          : "No emails sent"
      );

      setTimeout(() => {
        fetchQueueLeads();
      }, 1000);
    } catch (error) {
      setStatus("✗ Error sending emails");
      setFailed(1);
    } finally {
      setSending(false);
    }
  }

  const handleCancel = () => {
    if (sending) {
      if (window.confirm("Stop sending?")) {
        setSending(false);
      }
      return;
    }
    router.back();
  };

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "30px",
          paddingBottom: "20px",
          borderBottom: "2px solid #e5e7eb",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "28px", color: "#1f2937" }}>Email Queue</h1>
        <button
          onClick={handleCancel}
          style={{
            padding: "12px 16px", minHeight: "44px",
            backgroundColor: "#6b7280",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          {sending ? "⏹ Stop" : "← Back"}
        </button>
      </div>

      {/* MAIN ACTION */}
      {!loading && leads.length > 0 && (
        <div
          style={{
            padding: "20px",
            backgroundColor: "#f0fdf4",
            border: "2px solid #22c55e",
            borderRadius: "8px",
            marginBottom: "30px",
          }}
        >
          <div style={{ marginBottom: "15px" }}>
            <h2 style={{ margin: "0 0 8px 0", color: "#166534", fontSize: "18px" }}>
              Ready to send
            </h2>
            <p style={{ margin: 0, color: "#4b5563", fontSize: "32px", fontWeight: "bold" }}>
              {leads.length} leads with email
            </p>
          </div>

          <button
            onClick={handleSendBatch}
            disabled={sending}
            style={{
              padding: "14px 28px",
              backgroundColor: sending ? "#10b981" : "#059669",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: sending ? "wait" : "pointer",
              fontSize: "16px",
              fontWeight: "600",
              width: "100%",
              maxWidth: "300px",
              opacity: sending ? 0.8 : 1,
            }}
          >
            {sending ? `Sending... ${sent}/${leads.length}` : "SEND ALL NOW"}
          </button>
        </div>
      )}

      {/* STATUS */}
      {status && (
        <div
          style={{
            padding: "16px",
            backgroundColor: sent > 0 ? "#d1fae5" : "#fee2e2",
            border: `2px solid ${sent > 0 ? "#10b981" : "#ef4444"}`,
            borderRadius: "6px",
            marginBottom: "20px",
            fontSize: "16px",
            fontWeight: "500",
          }}
        >
          {status}
          {sent > 0 && ` (${failed} failed)`}
        </div>
      )}

      {/* LEADS LIST */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
          <p>Loading...</p>
        </div>
      ) : leads.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
          <p style={{ fontSize: "16px" }}>
            No leads with email addresses ready to send
          </p>
        </div>
      ) : (
        <div style={{ backgroundColor: "#f9fafb", borderRadius: "8px", overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "12px",
              padding: "16px",
            }}
          >
            {leads.slice(0, 20).map((lead) => (
              <div
                key={lead.id}
                style={{
                  padding: "12px",
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  fontSize: "13px",
                }}
              >
                <div style={{ fontWeight: "600", color: "#1f2937", marginBottom: "4px" }}>
                  {lead.business_name}
                </div>
                <div style={{ color: "#6b7280", wordBreak: "break-all" }}>
                  {lead.email}
                </div>
                <div style={{ color: "#9ca3af", marginTop: "6px" }}>
                  Email #{lead.email_sent_count + 1}/3
                </div>
              </div>
            ))}
          </div>
          {leads.length > 20 && (
            <div style={{ padding: "12px", textAlign: "center", color: "#6b7280" }}>
              +{leads.length - 20} more
            </div>
          )}
        </div>
      )}

      {/* FOOTER INFO */}
      <div style={{ marginTop: "30px", padding: "16px", backgroundColor: "#f3f4f6", borderRadius: "6px" }}>
        <p style={{ margin: 0, fontSize: "13px", color: "#4b5563" }}>
          ℹ️ Sends up to 25 per day. Respects bounces and opt-outs automatically.
        </p>
      </div>
    </div>
  );
}
