"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Reply {
  id: string;
  lead_id: string;
  company: string;
  contact?: string;
  message: string;
  classification?: string;
  status: string;
}

export default function RepliesPage() {
  const router = useRouter();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReplies();
  }, []);

  async function fetchReplies() {
    try {
      const response = await fetch("/api/crm/replies");
      const data = await response.json();
      setReplies(data || []);
    } catch (error) {
      console.error("Error fetching replies:", error);
    } finally {
      setLoading(false);
    }
  }

  async function classifyReply(replyId: string, message: string) {
    try {
      const response = await fetch("/api/crm/classify-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId, message }),
      });
      const data = await response.json();
      setReplies((prev) =>
        prev.map((r) =>
          r.id === replyId
            ? { ...r, classification: data.category, status: data.status }
            : r
        )
      );
    } catch (error) {
      console.error("Classification error:", error);
    }
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", borderBottom: "2px solid #e5e7eb", paddingBottom: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>Replies</h1>
        <button onClick={() => router.back()} style={{ padding: "12px 16px", minHeight: "44px", backgroundColor: "#6b7280", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>← Back</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : replies.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No replies yet</p>
      ) : (
        <div style={{ display: "grid", gap: "16px" }}>
          {replies.map((reply) => (
            <div key={reply.id} style={{ padding: "16px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "16px" }}>
                <div>
                  <div style={{ fontWeight: "600", fontSize: "16px", marginBottom: "8px" }}>
                    {reply.company} {reply.contact && `— ${reply.contact}`}
                  </div>
                  <div style={{ color: "#4b5563", marginBottom: "12px", lineHeight: "1.6" }}>
                    {reply.message}
                  </div>
                  {reply.classification && (
                    <div style={{ padding: "8px 12px", backgroundColor: "#dbeafe", borderRadius: "4px", fontSize: "13px", color: "#0c4a6e", fontWeight: "500" }}>
                      ✓ {reply.classification} — Status: {reply.status}
                    </div>
                  )}
                </div>
                {!reply.classification && (
                  <button
                    onClick={() => classifyReply(reply.id, reply.message)}
                    style={{
                      padding: "12px 16px", minHeight: "44px",
                      backgroundColor: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      height: "fit-content",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    Classify
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
