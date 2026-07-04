"use client";

import { useState, useEffect } from "react";

interface Lead {
  id: string;
  business_name: string;
  owner_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  status?: string;
  email_sent_count?: number;
  industry?: string;
  niche?: string;
  lead_ai_summaries?: Array<{
    lead_score?: number;
    confidence_level?: number;
    recommended_follow_up?: string;
  }>;
}

export default function DashboardTabs() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<keyof Lead>("business_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const res = await fetch("/api/admin/all-leads");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      setLoading(false);
    }
  }

  const getLeadScore = (lead: Lead) => {
    const summary = Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] : lead.lead_ai_summaries;
    return summary?.lead_score || 0;
  };

  const getFollowUp = (lead: Lead) => {
    const summary = Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] : lead.lead_ai_summaries;
    return summary?.recommended_follow_up || "—";
  };

  const sortedLeads = [...leads].sort((a, b) => {
    let aVal = a[sortField] ?? "";
    let bVal = b[sortField] ?? "";

    if (sortField === "business_name" || sortField === "owner_name") {
      aVal = String(aVal || "").toLowerCase();
      bVal = String(bVal || "").toLowerCase();
    }

    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const handleSort = (field: keyof Lead) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: keyof Lead }) => {
    if (sortField !== field) return <span className="text-gray-300">↕</span>;
    return <span>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  if (loading) return <div className="p-8 text-center">Loading leads...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
            <h1 className="text-3xl font-bold">All Leads</h1>
            <p className="text-blue-100 mt-1">Showing {leads.length} leads</p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-6 py-3 text-left">
                    <button onClick={() => handleSort("business_name")} className="flex items-center gap-2 font-semibold text-gray-700 hover:text-gray-900">
                      Business <SortIcon field="business_name" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left">
                    <button onClick={() => handleSort("owner_name")} className="flex items-center gap-2 font-semibold text-gray-700 hover:text-gray-900">
                      Owner <SortIcon field="owner_name" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Phone</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Email</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-6 py-3 text-left">
                    <button onClick={() => handleSort("id")} className="flex items-center gap-2 font-semibold text-gray-700 hover:text-gray-900">
                      Score <SortIcon field="id" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Follow-Up</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead) => {
                  const score = getLeadScore(lead);
                  const scoreColor = score >= 70 ? "bg-green-100 text-green-800" : score >= 50 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";

                  return (
                    <tr key={lead.id} className="border-b hover:bg-gray-50 transition">
                      <td className="px-6 py-4 font-medium text-gray-900">{lead.business_name}</td>
                      <td className="px-6 py-4 text-gray-700">{lead.owner_name || "—"}</td>
                      <td className="px-6 py-4 text-gray-700">
                        {lead.phone ? (
                          <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">
                            {lead.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline truncate max-w-xs">
                            {lead.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                          {lead.status || "New"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${scoreColor}`}>
                          {score}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-700 text-sm max-w-xs truncate">
                        {getFollowUp(lead)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {leads.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              <p>No leads found. Start by discovering leads or importing them.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
