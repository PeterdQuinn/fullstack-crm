"use client";

import { useState, useEffect } from "react";

interface Lead {
  id: string;
  business_name: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  niche?: string;
  rating?: number;
  created_at?: string;
}

type Tab = "info" | "source" | "enrichment" | "email" | "scoring";

export default function DiscoveryDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const res = await fetch("/api/admin/status");
      const data = await res.json();
      // Simulate discovered leads for now
      const mockLeads: Lead[] = [
        {
          id: "1",
          business_name: "Phoenix HVAC Pro",
          phone: "602-555-0101",
          email: "contact@phoenixhvac.com",
          city: "Phoenix",
          state: "AZ",
          niche: "HVAC",
          rating: 4.5,
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          business_name: "Desert Landscaping",
          phone: "602-555-0102",
          email: "info@desertlandscape.com",
          city: "Mesa",
          state: "AZ",
          niche: "Landscaping",
          rating: 4.7,
          created_at: new Date().toISOString(),
        },
      ];
      setLeads(mockLeads);
      if (mockLeads.length > 0) setSelectedLead(mockLeads[0]);
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      setLoading(false);
    }
  }

  async function runDiscovery() {
    setDiscovering(true);
    try {
      const res = await fetch("/api/admin/discover-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states: 1, limit: 10, enrichEmails: true, importToDb: true }),
      });
      const data = await res.json();
      alert(`✅ Discovered ${data.pipeline?.discovered || 0} leads!\nImported: ${data.pipeline?.imported || 0}`);
      await fetchLeads();
    } catch (error) {
      console.error("Discovery error:", error);
      alert("Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "info", label: "Info" },
    { id: "source", label: "Source" },
    { id: "enrichment", label: "Enrichment" },
    { id: "email", label: "Email" },
    { id: "scoring", label: "Scoring" },
  ];

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-4xl font-bold text-gray-900">Discovery Dashboard</h1>
          <button
            onClick={runDiscovery}
            disabled={discovering}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-semibold"
          >
            {discovering ? "🔍 Discovering..." : "🚀 Run Discovery"}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-6">
          {/* LEFT: TAB NAVIGATION */}
          <div className="space-y-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-4 py-3 rounded-lg font-semibold transition text-sm ${
                  activeTab === tab.id
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}

            <div className="pt-4 mt-4 border-t">
              <p className="text-xs font-semibold text-gray-500 mb-3">Discovered Leads ({leads.length})</p>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {leads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`w-full text-left p-2 text-xs rounded transition ${
                      selectedLead?.id === lead.id
                        ? "bg-indigo-100 border-l-2 border-indigo-600"
                        : "hover:bg-gray-100 border-l-2 border-transparent"
                    }`}
                  >
                    <p className="font-semibold text-gray-900">{lead.business_name}</p>
                    <p className="text-gray-500">{lead.city}, {lead.state}</p>
                    {lead.email && <p className="text-green-600">✓ Email</p>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: CONTENT */}
          <div className="col-span-3 bg-white rounded-lg shadow-lg p-8">
            {selectedLead ? (
              <>
                <h2 className="text-3xl font-bold mb-6 text-gray-900">{selectedLead.business_name}</h2>

                {activeTab === "info" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-semibold text-gray-500">Phone</label>
                        <p className="text-lg text-gray-900">{selectedLead.phone || "—"}</p>
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-gray-500">Email</label>
                        <p className="text-lg text-blue-600">{selectedLead.email || "Not found"}</p>
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-gray-500">City</label>
                        <p className="text-lg text-gray-900">{selectedLead.city || "—"}</p>
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-gray-500">Industry</label>
                        <p className="text-lg text-gray-900">{selectedLead.niche || "—"}</p>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "source" && (
                  <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                    <p className="text-sm text-gray-600">Source: <span className="font-semibold">Google Business / Yelp</span></p>
                    <p className="text-sm text-gray-600 mt-2">Rating: <span className="font-semibold">{selectedLead.rating || "N/A"}⭐</span></p>
                    <p className="text-sm text-gray-600 mt-2">Discovered: <span className="font-semibold">Today</span></p>
                  </div>
                )}

                {activeTab === "enrichment" && (
                  <div className="space-y-3">
                    <div className={`p-3 rounded ${selectedLead.email ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                      <p className="text-sm font-semibold">{selectedLead.email ? "✓ Email Found" : "✗ Email Missing"}</p>
                    </div>
                    <div className={`p-3 rounded ${selectedLead.phone ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                      <p className="text-sm font-semibold">{selectedLead.phone ? "✓ Phone Found" : "✗ Phone Missing"}</p>
                    </div>
                  </div>
                )}

                {activeTab === "email" && (
                  <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                    <p className="text-sm text-gray-600">Status: <span className="font-semibold text-green-600">Ready for Outreach</span></p>
                    <p className="text-sm text-gray-600 mt-2">Emails Sent: <span className="font-semibold">0/3</span></p>
                    {selectedLead.email && (
                      <button className="mt-4 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold">
                        Send Email 1
                      </button>
                    )}
                  </div>
                )}

                {activeTab === "scoring" && (
                  <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
                    <p className="text-sm text-gray-600">Lead Score: <span className="font-semibold">Pending</span></p>
                    <p className="text-sm text-gray-600 mt-2">Status: Leads will be auto-scored and emailed once imported</p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-gray-500 py-12">
                <p>Click "Run Discovery" to find new leads</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
