"use client";

import { useState, useEffect } from "react";

interface Lead {
  id: string;
  business_name: string;
  owner_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  short_description?: string;
  yelp_url?: string;
  bbb_url?: string;
  facebook_url?: string;
  linkedin_url?: string;
  instagram_url?: string;
  twitter_url?: string;
  current_software?: string;
  status?: string;
  email_sent_count?: number;
}

type Tab = "info" | "credibility" | "growth" | "outreach" | "ai" | "social";

export default function DashboardTabs() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const res = await fetch("/api/email/queue");
      const data = await res.json();
      setLeads(data.leads || []);
      if (data.leads && data.leads.length > 0) {
        setSelectedLead(data.leads[0]);
      }
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      setLoading(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "info", label: "Business Info", icon: "🏢" },
    { id: "credibility", label: "Credibility", icon: "⭐" },
    { id: "growth", label: "Growth Signals", icon: "📈" },
    { id: "outreach", label: "Outreach", icon: "📧" },
    { id: "ai", label: "AI Summary", icon: "🤖" },
    { id: "social", label: "Social", icon: "🔗" },
  ];

  const renderInfoTab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold text-gray-600">Business Name</label>
          <p className="text-lg">{selectedLead?.business_name || "—"}</p>
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-600">Owner</label>
          <p className="text-lg">{selectedLead?.owner_name || "—"}</p>
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-600">Phone</label>
          <p className="text-lg">{selectedLead?.phone || "—"}</p>
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-600">Email</label>
          <p className="text-lg">{selectedLead?.email || "—"}</p>
        </div>
      </div>
      <div>
        <label className="text-sm font-semibold text-gray-600">Website</label>
        {selectedLead?.website ? (
          <a href={selectedLead.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {selectedLead.website}
          </a>
        ) : (
          <p>—</p>
        )}
      </div>
      <div>
        <label className="text-sm font-semibold text-gray-600">Current Software</label>
        <p>{selectedLead?.current_software || "—"}</p>
      </div>
      <div>
        <label className="text-sm font-semibold text-gray-600">Description</label>
        <p className="text-gray-700">{selectedLead?.short_description || "—"}</p>
      </div>
    </div>
  );

  const renderCredibilityTab = () => (
    <div className="space-y-4">
      <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
        <h3 className="font-semibold mb-3">Trust Indicators</h3>
        <div className="space-y-2">
          {selectedLead?.yelp_url ? (
            <div className="flex items-center justify-between">
              <span>🟡 Yelp Profile</span>
              <a href={selectedLead.yelp_url} target="_blank" className="text-blue-600 text-sm">View</a>
            </div>
          ) : (
            <div className="text-gray-400">🟡 Yelp Profile: Not found</div>
          )}
          {selectedLead?.bbb_url ? (
            <div className="flex items-center justify-between">
              <span>✓ BBB Accredited</span>
              <a href={selectedLead.bbb_url} target="_blank" className="text-blue-600 text-sm">View</a>
            </div>
          ) : (
            <div className="text-gray-400">✓ BBB Status: Not found</div>
          )}
        </div>
      </div>
    </div>
  );

  const renderGrowthTab = () => (
    <div className="space-y-4">
      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
        <h3 className="font-semibold mb-3">Growth Signals</h3>
        <div className="space-y-2 text-gray-700">
          <p>📊 Analyzing growth opportunities...</p>
          <p className="text-sm">Job postings, employee count, and expansion signals</p>
        </div>
      </div>
    </div>
  );

  const renderOutreachTab = () => (
    <div className="space-y-4">
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h3 className="font-semibold mb-3">Outreach History</h3>
        <div className="space-y-2">
          <p>📧 Emails Sent: <strong>{selectedLead?.email_sent_count || 0}/3</strong></p>
          <p className="text-sm text-gray-600">Status: {selectedLead?.status || "—"}</p>
        </div>
      </div>
    </div>
  );

  const renderAITab = () => (
    <div className="space-y-4">
      <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
        <h3 className="font-semibold mb-3">AI Analysis</h3>
        <p className="text-gray-700 text-sm">Pain points, attack angles, and recommended messaging will appear here after AI scoring.</p>
      </div>
    </div>
  );

  const renderSocialTab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { name: "LinkedIn", url: selectedLead?.linkedin_url, icon: "🔗" },
          { name: "Facebook", url: selectedLead?.facebook_url, icon: "f" },
          { name: "Instagram", url: selectedLead?.instagram_url, icon: "📷" },
          { name: "Twitter", url: selectedLead?.twitter_url, icon: "𝕏" },
        ].map((social) => (
          <div key={social.name} className="p-3 border rounded-lg">
            <p className="text-sm font-semibold mb-1">{social.icon} {social.name}</p>
            {social.url ? (
              <a href={social.url} target="_blank" className="text-blue-600 text-xs truncate">
                View Profile
              </a>
            ) : (
              <p className="text-gray-400 text-xs">Not found</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "info":
        return renderInfoTab();
      case "credibility":
        return renderCredibilityTab();
      case "growth":
        return renderGrowthTab();
      case "outreach":
        return renderOutreachTab();
      case "ai":
        return renderAITab();
      case "social":
        return renderSocialTab();
      default:
        return null;
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-3 gap-6">
          {/* Left: Lead List */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-blue-600 text-white p-4 font-semibold">Leads ({leads.length})</div>
            <div className="overflow-y-auto max-h-[calc(100vh-150px)]">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={`p-4 border-b cursor-pointer transition ${
                    selectedLead?.id === lead.id ? "bg-blue-50 border-l-4 border-blue-600" : "hover:bg-gray-50"
                  }`}
                >
                  <p className="font-semibold text-gray-900">{lead.business_name}</p>
                  <p className="text-xs text-gray-500 mt-1">{lead.owner_name || "No owner"}</p>
                  <p className="text-xs text-gray-400 mt-1">{lead.email || "No email"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Lead Details with Tabs */}
          <div className="col-span-2 bg-white rounded-lg shadow-md overflow-hidden">
            {selectedLead ? (
              <>
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
                  <h1 className="text-3xl font-bold">{selectedLead.business_name}</h1>
                  <p className="text-blue-100 mt-1">Owner: {selectedLead.owner_name || "Unknown"}</p>
                </div>

                {/* Tabs */}
                <div className="flex border-b overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-3 font-medium text-sm whitespace-nowrap transition ${
                        activeTab === tab.id
                          ? "border-b-2 border-blue-600 text-blue-600 bg-blue-50"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      <span>{tab.icon}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div className="p-6">{renderTab()}</div>
              </>
            ) : (
              <div className="p-6 text-center text-gray-500">Select a lead to view details</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
