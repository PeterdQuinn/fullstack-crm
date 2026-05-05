"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

interface Stats {
  emailQueue: number;
  callQueue: number;
  dmQueue: number;
  replies: number;
  bookings: number;
  onboarding: number;
}

export default function CRMDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    emailQueue: 0,
    callQueue: 0,
    dmQueue: 0,
    replies: 0,
    bookings: 0,
    onboarding: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const response = await fetch("/api/crm/stats");
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  }

  const queues = [
    { name: "Email Queue", count: stats.emailQueue, path: "/crm/email-queue", color: "#3b82f6", icon: "📧" },
    { name: "Replies", count: stats.replies, path: "/crm/replies", color: "#8b5cf6", icon: "💬" },
    { name: "Call Queue", count: stats.callQueue, path: "/crm/call-queue", color: "#ef4444", icon: "☎️" },
    { name: "DM Queue", count: stats.dmQueue, path: "/crm/dm-queue", color: "#ec4899", icon: "💌" },
    { name: "Bookings", count: stats.bookings, path: "/crm/bookings", color: "#10b981", icon: "📅" },
    { name: "Onboarding", count: stats.onboarding, path: "/crm/onboarding", color: "#f59e0b", icon: "🎓" },
  ];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb" }}>
      {/* HEADER */}
      <div style={{ backgroundColor: "white", borderBottom: "2px solid #e5e7eb", padding: "20px" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h1 style={{ margin: 0, fontSize: "32px", fontWeight: "700", color: "#1f2937" }}>CRM Dashboard</h1>
            <button
              onClick={() => router.push("/")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#e5e7eb",
                color: "#1f2937",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500",
              }}
            >
              ← Main App
            </button>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "30px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
          {queues.map((queue) => (
            <button
              key={queue.path}
              onClick={() => router.push(queue.path)}
              style={{
                padding: "24px",
                backgroundColor: "white",
                border: `3px solid ${queue.color}`,
                borderRadius: "12px",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 10px 25px rgba(0,0,0,0.1)";
                (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
                (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
              }}
            >
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>{queue.icon}</div>
              <h2 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600", color: "#1f2937" }}>
                {queue.name}
              </h2>
              <div style={{ fontSize: "36px", fontWeight: "700", color: queue.color }}>
                {queue.count}
              </div>
              <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
                {queue.count === 1 ? "item" : "items"} ready
              </div>
            </button>
          ))}
        </div>

        {/* QUICK ACTIONS */}
        <div style={{ marginTop: "40px", padding: "20px", backgroundColor: "white", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600" }}>Quick Actions</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
            <button
              onClick={() => router.push("/crm/email-queue")}
              style={{
                padding: "12px",
                backgroundColor: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >
              Send Emails
            </button>
            <button
              onClick={() => router.push("/crm/call-queue")}
              style={{
                padding: "12px",
                backgroundColor: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >
              Start Calling
            </button>
            <button
              onClick={() => router.push("/crm/dm-queue")}
              style={{
                padding: "12px",
                backgroundColor: "#ec4899",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >
              Send DMs
            </button>
            <button
              onClick={() => fetchStats()}
              style={{
                padding: "12px",
                backgroundColor: "#6b7280",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >
              Refresh Stats
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
