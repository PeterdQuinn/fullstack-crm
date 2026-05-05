"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Lead {
  id: string;
  business_name: string;
  contact_name?: string;
  email?: string;
  status: string;
  onboarding_sent: boolean;
  onboarding_completed: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const response = await fetch("/api/crm/onboarding-queue");
      const data = await response.json();
      setLeads(data || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function markOnboardingSent(leadId: string) {
    try {
      await fetch("/api/crm/onboarding-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      fetchLeads();
    } catch (error) {
      console.error("Error:", error);
    }
  }

  async function markOnboardingCompleted(leadId: string) {
    try {
      await fetch("/api/crm/onboarding-completed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      fetchLeads();
    } catch (error) {
      console.error("Error:", error);
    }
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", borderBottom: "2px solid #e5e7eb", paddingBottom: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>Onboarding</h1>
        <button onClick={() => router.back()} style={{ padding: "8px 16px", backgroundColor: "#6b7280", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>← Back</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : leads.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No onboarding needed</p>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {leads.map((lead) => (
            <div key={lead.id} style={{ padding: "16px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", display: "grid", gridTemplateColumns: "1fr auto", gap: "16px", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: "600", fontSize: "16px", marginBottom: "4px" }}>
                  {lead.business_name}
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280" }}>
                  {lead.email || "No email"}
                </div>
              </div>
              <div style={{ display: "grid", gap: "8px" }}>
                {!lead.onboarding_sent && (
                  <button
                    onClick={() => markOnboardingSent(lead.id)}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    Send Onboarding
                  </button>
                )}
                {lead.onboarding_sent && !lead.onboarding_completed && (
                  <button
                    onClick={() => markOnboardingCompleted(lead.id)}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#10b981",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    ✓ Completed
                  </button>
                )}
                {lead.onboarding_completed && (
                  <div style={{ padding: "8px 16px", backgroundColor: "#d1fae5", color: "#065f46", borderRadius: "6px", fontSize: "13px", fontWeight: "500", textAlign: "center" }}>
                    ✓ Done
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
