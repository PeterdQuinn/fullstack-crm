"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Booking {
  id: string;
  business_name: string;
  contact?: string;
  email?: string;
  status: string;
  booked_at?: string;
  no_show: boolean;
}

const STATUSES = ["Booking Link Sent", "Booking Follow-Up 1", "Booking Follow-Up 2", "Booked", "No-show"];

export default function BookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBookings();
  }, []);

  async function fetchBookings() {
    try {
      const response = await fetch("/api/crm/bookings");
      const data = await response.json();
      setBookings(data || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(bookingId: string, status: string) {
    try {
      await fetch("/api/crm/update-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, status }),
      });
      fetchBookings();
    } catch (error) {
      console.error("Error:", error);
    }
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", borderBottom: "2px solid #e5e7eb", paddingBottom: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>Bookings</h1>
        <button onClick={() => router.back()} style={{ padding: "12px 16px", minHeight: "44px", backgroundColor: "#6b7280", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>← Back</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : bookings.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No bookings</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "#f3f4f6", borderBottom: "2px solid #d1d5db" }}>
                <th style={{ padding: "10px", textAlign: "left" }}>Company</th>
                <th style={{ padding: "10px", textAlign: "left" }}>Contact</th>
                <th style={{ padding: "10px", textAlign: "left" }}>Status</th>
                <th style={{ padding: "10px", textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px" }}>
                    <strong>{booking.business_name}</strong>
                  </td>
                  <td style={{ padding: "10px", color: "#6b7280" }}>
                    {booking.contact || "—"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <span style={{ padding: "4px 8px", backgroundColor: "#dbeafe", color: "#0c4a6e", borderRadius: "4px", fontSize: "12px" }}>
                      {booking.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    <select
                      value={booking.status}
                      onChange={(e) => updateStatus(booking.id, e.target.value)}
                      style={{ padding: "6px 8px", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "12px" }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
