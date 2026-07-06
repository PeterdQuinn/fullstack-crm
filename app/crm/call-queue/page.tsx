"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Lead {
  id: string;
  business_name: string;
  contact_name?: string;
  phone?: string;
  status: string;
}

const CALL_OUTCOMES = ["No Answer", "Left Voicemail", "Connected", "Interested", "Not Interested", "Call Back Later", "Bad Number", "Booked"];

export default function CallQueuePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);

  useEffect(() => {
    fetchQueue();
  }, []);

  async function fetchQueue() {
    try {
      const response = await fetch("/api/crm/call-queue");
      const data = await response.json();
      setLeads(data || []);
    } catch (error) {
      console.error("Error fetching queue:", error);
    } finally {
      setLoading(false);
    }
  }

  async function logCall(leadId: string, outcome: string) {
    try {
      await fetch("/api/crm/log-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, outcome, notes: "" }),
      });
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      setSelectedLead(null);
    } catch (error) {
      console.error("Error logging call:", error);
    }
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", borderBottom: "2px solid #e5e7eb", paddingBottom: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>Call Queue</h1>
        <button onClick={() => router.back()} style={{ padding: "12px 16px", minHeight: "44px", backgroundColor: "#6b7280", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>← Back</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : leads.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No calls needed</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "20px" }}>
          {/* LIST */}
          <div style={{ display: "grid", gap: "8px", maxHeight: "70vh", overflowY: "auto" }}>
            {leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => setSelectedLead(lead.id)}
                style={{
                  padding: "12px",
                  backgroundColor: selectedLead === lead.id ? "#3b82f6" : "#f9fafb",
                  color: selectedLead === lead.id ? "white" : "#1f2937",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "13px",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontWeight: "600", marginBottom: "4px" }}>{lead.business_name}</div>
                <div style={{ fontSize: "12px", opacity: 0.8 }}>{lead.phone || "No phone"}</div>
              </button>
            ))}
          </div>

          {/* DETAIL */}
          {selectedLead && (
            <div style={{ padding: "20px", backgroundColor: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
              {leads.find((l) => l.id === selectedLead) && (
                <>
                  <h2 style={{ margin: "0 0 20px 0" }}>
                    {leads.find((l) => l.id === selectedLead)?.business_name}
                  </h2>
                  <div style={{ marginBottom: "20px" }}>
                    <a
                      href={`tel:${leads.find((l) => l.id === selectedLead)?.phone}`}
                      style={{
                        display: "inline-block",
                        padding: "12px 20px",
                        backgroundColor: "#10b981",
                        color: "white",
                        textDecoration: "none",
                        borderRadius: "6px",
                        fontWeight: "600",
                      }}
                    >
                      ☎️ Call Now
                    </a>
                  </div>

                  <div style={{ marginBottom: "20px" }}>
                    <label style={{ display: "block", marginBottom: "10px", fontSize: "13px", fontWeight: "600" }}>
                      Call Outcome:
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                      {CALL_OUTCOMES.map((outcome) => (
                        <button
                          key={outcome}
                          onClick={() => logCall(selectedLead, outcome)}
                          style={{
                            padding: "10px",
                            backgroundColor: "#dbeafe",
                            color: "#0c4a6e",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: "500",
                          }}
                        >
                          {outcome}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
