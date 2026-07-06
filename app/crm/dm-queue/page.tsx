"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Lead {
  id: string;
  business_name: string;
  contact_name?: string;
  phone?: string | null;
  email?: string | null;
  socials: Array<{ platform: string; url?: string; username?: string }>;
}

export default function DMQueuePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQueue();
  }, []);

  async function fetchQueue() {
    try {
      const response = await fetch("/api/crm/dm-queue");
      const data = await response.json();
      setLeads(data || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function markDMSent(leadId: string) {
    try {
      await fetch("/api/crm/mark-dm-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
    } catch (error) {
      console.error("Error:", error);
    }
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", borderBottom: "2px solid #e5e7eb", paddingBottom: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>DM Queue</h1>
        <button onClick={() => router.back()} style={{ padding: "12px 16px", minHeight: "44px", backgroundColor: "#6b7280", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>← Back</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : leads.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No DMs needed</p>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {leads.map((lead) => (
            <div key={lead.id} style={{ padding: "16px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", display: "grid", gridTemplateColumns: "1fr auto", gap: "16px", alignItems: "start" }}>
              <div>
                <div style={{ fontWeight: "600", fontSize: "16px", marginBottom: "4px" }}>
                  {lead.business_name}
                </div>
                {/* Lead phone + email attached, so you can call/email as well as DM */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "13px", marginBottom: "8px" }}>
                  {lead.phone ? (
                    <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}>
                      📞 {lead.phone}
                    </a>
                  ) : (
                    <span style={{ color: "#9ca3af" }}>📞 No phone</span>
                  )}
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}>
                      ✉️ {lead.email}
                    </a>
                  ) : (
                    <span style={{ color: "#9ca3af" }}>✉️ No email</span>
                  )}
                </div>
                <div style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#6b7280" }}>
                  {lead.socials?.map((social, i) => (
                    <div key={i}>
                      <strong>{social.platform}:</strong>{" "}
                      {social.url ? (
                        <a href={social.url} target="_blank" rel="noopener" style={{ color: "#3b82f6", textDecoration: "none" }}>
                          {social.username || "Open Profile"}
                        </a>
                      ) : (
                        social.username
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gap: "8px" }}>
                <button
                  onClick={() => window.open(lead.socials[0]?.url)}
                  style={{ padding: "12px 16px", minHeight: "44px", backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "500" }}
                >
                  Open Profile
                </button>
                <button
                  onClick={() => markDMSent(lead.id)}
                  style={{ padding: "12px 16px", minHeight: "44px", backgroundColor: "#10b981", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "500" }}
                >
                  ✓ DM Sent
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
