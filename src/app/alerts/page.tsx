"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getAlerts, type Alert } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const CATEGORY_COLORS: Record<string, string> = {
  "Tender Announcement": "bg-red-100 text-red-800",
  "Policy/Regulatory": "bg-purple-100 text-purple-800",
  "Market Update": "bg-blue-100 text-blue-800",
  "Technology": "bg-cyan-100 text-cyan-800",
  "Competition": "bg-amber-100 text-amber-800",
  "Opportunity": "bg-green-100 text-green-800",
  "General": "bg-gray-100 text-gray-600",
};

function scoreColor(score: number | null): string {
  if (!score) return "text-gray-300";
  if (score >= 8) return "text-red-600 font-bold";
  if (score >= 6) return "text-amber-600 font-semibold";
  if (score >= 4) return "text-gray-600";
  return "text-gray-400";
}

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
}

const CATEGORY_FILTERS = ["All", "Tender Announcement", "Policy/Regulatory", "Market Update", "Technology", "Competition", "Opportunity", "General"];

function AlertsContent() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [minScore, setMinScore] = useState(0);

  useEffect(() => {
    getAlerts(200).then(setAlerts).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = [...alerts];
    // Sort by relevance score first (highest first), then by date
    result.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) =>
        [a.title, a.source, a.authority, a.oneLinerInsight, ...(a.authorities || []), ...(a.companies || []), ...(a.states || [])]
          .some((f) => (f || "").toLowerCase().includes(q))
      );
    }
    if (catFilter !== "All") {
      result = result.filter((a) => a.alertCategory === catFilter);
    }
    if (minScore > 0) {
      result = result.filter((a) => (a.relevanceScore || 0) >= minScore);
    }
    return result;
  }, [alerts, search, catFilter, minScore]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Industry Alerts</h1>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input type="text" placeholder="Search alerts, companies, states..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {CATEGORY_FILTERS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={minScore} onChange={(e) => setMinScore(parseInt(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
            <option value={0}>All Scores</option>
            <option value={7}>Score 7+ (High)</option>
            <option value={5}>Score 5+ (Medium)</option>
            <option value={3}>Score 3+ (Low)</option>
          </select>
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} alerts</span>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No alerts match your filters</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((alert) => (
              <div key={alert.id} className={`bg-white rounded-lg border p-4 hover:shadow-sm transition-shadow ${
                alert.isTenderAnnouncement ? "border-l-4 border-l-red-500" : ""
              }`}>
                <div className="flex items-start gap-3">
                  {/* Relevance score */}
                  <div className={`text-lg w-8 text-center shrink-0 ${scoreColor(alert.relevanceScore)}`}>
                    {alert.relevanceScore || "-"}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    <p className="text-sm font-medium text-gray-900 leading-snug">{alert.title}</p>

                    {/* LLM Insight */}
                    {alert.oneLinerInsight && (
                      <p className="text-xs text-[#0D1F3C] mt-1 italic">{alert.oneLinerInsight}</p>
                    )}

                    {/* Tags row */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Category badge */}
                      {alert.alertCategory && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${CATEGORY_COLORS[alert.alertCategory] || CATEGORY_COLORS.General}`}>
                          {alert.alertCategory}
                        </span>
                      )}

                      {/* Source */}
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{alert.source}</span>

                      {/* Tender announcement flag */}
                      {alert.isTenderAnnouncement && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">NEW TENDER</span>
                      )}

                      {/* Authorities */}
                      {alert.authorities?.map((auth) => (
                        <button key={auth} onClick={() => router.push(`/authorities?expand=${encodeURIComponent(auth)}`)}
                          className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-100">{auth}</button>
                      ))}

                      {/* Companies */}
                      {alert.companies?.map((comp) => (
                        <span key={comp} className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{comp}</span>
                      ))}

                      {/* States */}
                      {alert.states?.map((state) => (
                        <span key={state} className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">{state}</span>
                      ))}

                      {/* MW/MWh */}
                      {alert.powerMW && <span className="text-[10px] text-gray-500">{alert.powerMW} MW</span>}
                      {alert.energyMWh && <span className="text-[10px] text-gray-500">{alert.energyMWh} MWh</span>}

                      {/* Date */}
                      <span className="text-[10px] text-gray-400">{formatDate(alert.publishedAt)}</span>
                    </div>
                  </div>

                  {/* Read link */}
                  {alert.sourceUrl && (
                    <a href={alert.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#0D1F3C] hover:underline shrink-0 mt-1">Read &rarr;</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  return <AuthGuard><AlertsContent /></AuthGuard>;
}
