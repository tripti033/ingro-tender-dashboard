"use client";

import { useEffect, useState, useMemo } from "react";
import { getAlerts, type Alert } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "\u2014"; }
}

function AlertsContent() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getAlerts(100).then(setAlerts).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return alerts;
    const q = search.toLowerCase();
    return alerts.filter((a) =>
      [a.title, a.source, a.authority].some((f) => (f || "").toLowerCase().includes(q))
    );
  }, [alerts, search]);

  return (
    <div className="sidebar-content min-h-screen bg-gray-50">
      <div className="px-6 py-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Industry Alerts</h1>

        <div className="flex items-center gap-3 mb-4">
          <input type="text" placeholder="Search alerts..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} alerts</span>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No alerts match your search</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((alert) => (
              <div key={alert.id} className="bg-white rounded-lg border p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 leading-snug">{alert.title}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{alert.source}</span>
                      {alert.authority && (
                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{alert.authority}</span>
                      )}
                      {alert.powerMW != null && <span>{alert.powerMW} MW</span>}
                      {alert.energyMWh != null && <span>{alert.energyMWh} MWh</span>}
                      <span>{formatDate(alert.publishedAt)}</span>
                    </div>
                  </div>
                  {alert.sourceUrl && (
                    <a href={alert.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-[#0D1F3C] hover:underline whitespace-nowrap shrink-0">
                      Read &rarr;
                    </a>
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
  return <AuthGuard><Sidebar /><AlertsContent /></AuthGuard>;
}
