"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getTenders, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

interface AuthorityGroup {
  name: string;
  tenders: Tender[];
  activeTenders: number;
  totalMW: number;
  totalMWh: number;
}

function AuthoritiesContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const expandParam = searchParams.get("expand");
  const [expanded, setExpanded] = useState<string | null>(expandParam);

  useEffect(() => {
    getTenders().then(setTenders).finally(() => setLoading(false));
  }, []);

  // Auto-expand from URL param
  useEffect(() => {
    if (expandParam) setExpanded(expandParam);
  }, [expandParam]);

  const authorities = useMemo(() => {
    const groups: Record<string, AuthorityGroup> = {};
    for (const t of tenders) {
      const auth = t.authority || "Unknown";
      if (!groups[auth]) {
        groups[auth] = { name: auth, tenders: [], activeTenders: 0, totalMW: 0, totalMWh: 0 };
      }
      groups[auth].tenders.push(t);
      if (t.tenderStatus !== "closed" && t.tenderStatus !== "cancelled") groups[auth].activeTenders++;
      if (t.powerMW) groups[auth].totalMW += t.powerMW;
      if (t.energyMWh) groups[auth].totalMWh += t.energyMWh;
    }
    return Object.values(groups).sort((a, b) => b.tenders.length - a.tenders.length);
  }, [tenders]);

  const filtered = useMemo(() => {
    if (!search) return authorities;
    const q = search.toLowerCase();
    return authorities.filter((a) => a.name.toLowerCase().includes(q));
  }, [authorities, search]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Authorities</h1>

        <div className="flex items-center gap-3 mb-4">
          <input type="text" placeholder="Search authority..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} authorities</span>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((auth) => (
              <div key={auth.name} className="bg-white rounded-lg border overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === auth.name ? null : auth.name)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold text-gray-900">{auth.name}</span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{auth.tenders.length} tenders</span>
                    {auth.activeTenders > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{auth.activeTenders} active</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    {auth.totalMW > 0 && <span>{auth.totalMW.toLocaleString()} MW</span>}
                    {auth.totalMWh > 0 && <span>{auth.totalMWh.toLocaleString()} MWh</span>}
                    <span className={`transition-transform ${expanded === auth.name ? "rotate-180" : ""}`}>{"\u25BC"}</span>
                  </div>
                </button>
                {expanded === auth.name && (
                  <div className="border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                        <tr>
                          <th className="px-4 py-2">NIT</th>
                          <th className="px-4 py-2">Title</th>
                          <th className="px-4 py-2 text-right">MW</th>
                          <th className="px-4 py-2 text-right">MWh</th>
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2">Awarded To</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {auth.tenders.map((t) => (
                          <tr key={t.nitNumber} onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}`)}
                            className="hover:bg-gray-50 cursor-pointer">
                            <td className="px-4 py-2 font-mono text-xs">{t.nitNumber.slice(0, 25)}</td>
                            <td className="px-4 py-2 text-xs max-w-[300px] truncate">{t.title}</td>
                            <td className="px-4 py-2 text-right">{t.powerMW?.toLocaleString() || "\u2014"}</td>
                            <td className="px-4 py-2 text-right">{t.energyMWh?.toLocaleString() || "\u2014"}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                t.tenderStatus === "active" ? "bg-green-100 text-green-800" :
                                t.tenderStatus === "closing_soon" ? "bg-amber-100 text-amber-800" :
                                t.tenderStatus === "closed" ? "bg-red-100 text-red-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>{t.tenderStatus}</span>
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-500">{t.awardedTo || "\u2014"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuthoritiesPage() {
  return <AuthGuard><Sidebar /><AuthoritiesContent /></AuthGuard>;
}
