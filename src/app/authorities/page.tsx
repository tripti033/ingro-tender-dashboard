"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
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

const SORT_OPTIONS = ["Most Tenders", "Most Active", "Name (A\u2013Z)"];

function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  try {
    const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  } catch { return t.daysLeft ?? null; }
}

function isActiveOrClosingSoon(t: Tender): boolean {
  if (t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return false;
  const days = liveDaysLeft(t);
  return days == null || days >= 0;
}

function AuthoritiesContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("Most Tenders");

  useEffect(() => {
    getTenders().then(setTenders).finally(() => setLoading(false));
  }, []);

  const authorities = useMemo(() => {
    const groups: Record<string, AuthorityGroup> = {};
    for (const t of tenders) {
      const auth = t.authority || "Unknown";
      if (!groups[auth]) {
        groups[auth] = { name: auth, tenders: [], activeTenders: 0, totalMW: 0, totalMWh: 0 };
      }
      groups[auth].tenders.push(t);
      if (isActiveOrClosingSoon(t)) groups[auth].activeTenders++;
      if (t.powerMW) groups[auth].totalMW += t.powerMW;
      if (t.energyMWh) groups[auth].totalMWh += t.energyMWh;
    }
    return Object.values(groups);
  }, [tenders]);

  const filtered = useMemo(() => {
    let result = authorities;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(q));
    }
    const sorted = [...result];
    switch (sortBy) {
      case "Most Tenders": sorted.sort((a, b) => b.tenders.length - a.tenders.length); break;
      case "Most Active": sorted.sort((a, b) => b.activeTenders - a.activeTenders || b.tenders.length - a.tenders.length); break;
      case "Name (A\u2013Z)": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return sorted;
  }, [authorities, search, sortBy]);

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <h1 className="text-xl font-bold text-gray-100 mb-4">Authorities</h1>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            placeholder="Search authority..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
          />
          <div className="flex flex-col">
            <label className="text-[10px] text-gray-400 uppercase tracking-wider pl-1">Sort by</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              {SORT_OPTIONS.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </div>
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} authorities</span>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-16 bg-gray-800 rounded animate-pulse" />)}</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((auth) => (
              <button
                key={auth.name}
                onClick={() => router.push(`/authority/${encodeURIComponent(auth.name)}`)}
                className="w-full flex items-center justify-between px-5 py-4 bg-[var(--bg-card)] rounded-lg border hover:bg-[var(--bg-subtle)] hover:border-gray-300 transition-colors text-left"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-sm font-semibold text-gray-100 truncate">{auth.name}</span>
                  <span className="text-xs bg-gray-800 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">{auth.tenders.length} tenders</span>
                  {auth.activeTenders > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">{auth.activeTenders} active</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400 whitespace-nowrap">
                  {auth.totalMW > 0 && <span>{auth.totalMW.toLocaleString()} MW</span>}
                  {auth.totalMWh > 0 && <span>{auth.totalMWh.toLocaleString()} MWh</span>}
                  <span>&rarr;</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuthoritiesPage() {
  return <AuthGuard><AuthoritiesContent /></AuthGuard>;
}
