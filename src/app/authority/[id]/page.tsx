"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getTenders, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "\u2014"; }
}

function truncate(str: string | null, max: number): string {
  if (!str) return "\u2014";
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

function statusLabel(t: Tender): { label: string; color: string } {
  const days = liveDaysLeft(t);
  if (t.tenderStatus === "awarded") return { label: "awarded", color: "bg-teal-100 text-teal-800" };
  if (t.tenderStatus === "cancelled") return { label: "cancelled", color: "bg-gray-100 text-gray-600" };
  if (days != null && days < 0) return { label: "closed", color: "bg-red-100 text-red-700" };
  if (days != null && days <= 7) return { label: "closing_soon", color: "bg-amber-100 text-amber-800" };
  return { label: "active", color: "bg-green-100 text-green-800" };
}

function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  try {
    const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  } catch { return t.daysLeft ?? null; }
}

function AuthorityDetailContent() {
  const router = useRouter();
  const params = useParams();
  const authorityId = decodeURIComponent((params.id as string) || "");

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    getTenders().then(setTenders).finally(() => setLoading(false));
  }, []);

  const authTenders = useMemo(
    () => tenders.filter((t) => (t.authority || "Unknown") === authorityId),
    [tenders, authorityId],
  );

  const visible = useMemo(() => {
    let result = [...authTenders];
    if (statusFilter !== "All") {
      result = result.filter((t) => statusLabel(t).label === statusFilter);
    }
    // Sort by most urgent (days left asc, null last)
    result.sort((a, b) => (liveDaysLeft(a) ?? 9999) - (liveDaysLeft(b) ?? 9999));
    return result;
  }, [authTenders, statusFilter]);

  const stats = useMemo(() => {
    const s = { active: 0, closing_soon: 0, closed: 0, awarded: 0, totalMW: 0, totalMWh: 0 };
    for (const t of authTenders) {
      const label = statusLabel(t).label;
      if (label in s) (s as Record<string, number>)[label]++;
      if (t.powerMW) s.totalMW += t.powerMW;
      if (t.energyMWh) s.totalMWh += t.energyMWh;
    }
    return s;
  }, [authTenders]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <button onClick={() => router.push("/authorities")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">
          &larr; All Authorities
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">{authorityId}</h1>
        <p className="text-sm text-gray-500 mb-6">Authority details and tenders</p>

        {loading ? (
          <div className="h-64 bg-gray-100 rounded animate-pulse" />
        ) : authTenders.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No tenders found for this authority</div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
              <div className="bg-white rounded-lg border p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Total</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{authTenders.length}</div>
              </div>
              <div className="bg-green-50 rounded-lg border border-green-100 p-4">
                <div className="text-xs text-green-700 uppercase tracking-wider">Active</div>
                <div className="text-xl font-bold text-green-900 mt-1">{stats.active}</div>
              </div>
              <div className="bg-amber-50 rounded-lg border border-amber-100 p-4">
                <div className="text-xs text-amber-700 uppercase tracking-wider">Closing Soon</div>
                <div className="text-xl font-bold text-amber-900 mt-1">{stats.closing_soon}</div>
              </div>
              <div className="bg-red-50 rounded-lg border border-red-100 p-4">
                <div className="text-xs text-red-700 uppercase tracking-wider">Closed</div>
                <div className="text-xl font-bold text-red-900 mt-1">{stats.closed}</div>
              </div>
              <div className="bg-white rounded-lg border p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Total MW</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{stats.totalMW.toLocaleString()}</div>
              </div>
              <div className="bg-white rounded-lg border p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Total MWh</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{stats.totalMWh.toLocaleString()}</div>
              </div>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
              >
                <option value="All">All</option>
                <option value="active">Active</option>
                <option value="closing_soon">Closing Soon</option>
                <option value="closed">Closed</option>
                <option value="awarded">Awarded</option>
              </select>
              <span className="text-sm text-gray-400 ml-auto">{visible.length} of {authTenders.length}</span>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">NIT</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 text-right">MW</th>
                    <th className="px-4 py-3 text-right">MWh</th>
                    <th className="px-4 py-3">Deadline</th>
                    <th className="px-4 py-3">Days Left</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Awarded To</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((t) => {
                    const status = statusLabel(t);
                    const days = liveDaysLeft(t);
                    const href = `/tender/${encodeURIComponent(t.nitNumber)}?from=${encodeURIComponent(`/authority/${encodeURIComponent(authorityId)}`)}`;
                    return (
                      <tr
                        key={t.nitNumber}
                        onClick={(e) => {
                          // Open in new tab to preserve list scroll position
                          if (e.metaKey || e.ctrlKey) return;
                          window.open(href, "_blank", "noopener,noreferrer");
                        }}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap" title={t.nitNumber}>
                          {truncate(t.nitNumber, 25)}
                        </td>
                        <td className="px-4 py-2.5 text-xs max-w-[360px] truncate" title={t.title || ""}>
                          {t.title || "\u2014"}
                        </td>
                        <td className="px-4 py-2.5 text-right">{t.powerMW?.toLocaleString() || "\u2014"}</td>
                        <td className="px-4 py-2.5 text-right">{t.energyMWh?.toLocaleString() || "\u2014"}</td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatDate(t.bidDeadline)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          {days == null ? "\u2014" : days < 0 ? <span className="text-gray-400 line-through">closed</span> : <span className={days <= 7 ? "text-red-600 font-semibold" : ""}>{days}d</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{t.awardedTo || "\u2014"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthorityDetailPage() {
  return <AuthGuard><AuthorityDetailContent /></AuthGuard>;
}
