"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getTenders, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const AUTHORITIES = [
  "All", "SECI", "NTPC", "GUVNL", "MSEDCL", "RRVUNL", "UJVNL",
  "TNGECL", "SJVNL", "DHBVN", "WBSEDCL", "MSETCL", "GeM", "Others",
];
const CATEGORIES = ["All", "Standalone", "FDRE", "S+S", "PSP", "Hybrid", "Pump Storage Plant"];
const AWARD_FILTER = ["All", "Awarded", "Unawarded"];
const SORT_OPTIONS = [
  "Recently Closed",
  "Bid Deadline (desc)",
  "Size MW (desc)",
  "Size MWh (desc)",
];

function authorityColor(auth: string | null): string {
  const colors: Record<string, string> = {
    SECI: "bg-blue-100 text-blue-800",
    NTPC: "bg-orange-100 text-orange-800",
    GUVNL: "bg-green-100 text-green-800",
    MSEDCL: "bg-purple-100 text-purple-800",
    RRVUNL: "bg-amber-100 text-amber-800",
    TNGECL: "bg-rose-100 text-rose-800",
    SJVNL: "bg-cyan-100 text-cyan-800",
    GeM: "bg-teal-100 text-teal-800",
  };
  return colors[auth || ""] || "bg-gray-100 text-gray-700";
}

function categoryColor(cat: string | null): string {
  const colors: Record<string, string> = {
    Standalone: "bg-slate-100 text-slate-700",
    FDRE: "bg-indigo-100 text-indigo-800",
    "S+S": "bg-yellow-100 text-yellow-800",
    PSP: "bg-emerald-100 text-emerald-800",
    "Pump Storage Plant": "bg-emerald-100 text-emerald-800",
    Hybrid: "bg-pink-100 text-pink-800",
  };
  return colors[cat || ""] || "bg-gray-100 text-gray-700";
}

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "\u2014";
  }
}

function truncate(str: string | null, max: number): string {
  if (!str) return "\u2014";
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

function ArchivesContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [authority, setAuthority] = useState("All");
  const [awardFilter, setAwardFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Recently Closed");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const isArchived = (t: Tender) => {
    // Include tenders that are closed, awarded, cancelled, OR whose
    // deadline has passed (even if the status field is stale).
    if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return true;
    if (!t.bidDeadline) return false;
    try {
      const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
      return d.getTime() < Date.now();
    } catch { return false; }
  };

  const loadTenders = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await getTenders();
      setTenders(all.filter(isArchived));
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 800));
        const all = await getTenders();
        setTenders(all.filter(isArchived));
      } catch {
        setError("Failed to load archives.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, category, authority, awardFilter, sortBy]);

  const filtered = useMemo(() => {
    let result = [...tenders];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        [t.title, t.authority, t.nitNumber, t.location, t.category, t.awardedTo]
          .some((f) => (f || "").toLowerCase().includes(q))
      );
    }
    if (category !== "All") result = result.filter((t) => t.category === category);
    if (authority !== "All") {
      if (authority === "Others") {
        const known = AUTHORITIES.filter((a) => a !== "All" && a !== "Others");
        result = result.filter((t) => !known.includes(t.authority || ""));
      } else {
        result = result.filter((t) => t.authority === authority);
      }
    }
    if (awardFilter === "Awarded") result = result.filter((t) => !!t.awardedTo);
    else if (awardFilter === "Unawarded") result = result.filter((t) => !t.awardedTo);

    const ts = (v: { toDate?: () => Date } | null): number =>
      v && typeof v.toDate === "function" ? v.toDate().getTime() : 0;

    result.sort((a, b) => {
      switch (sortBy) {
        case "Recently Closed": return ts(b.lastUpdatedAt) - ts(a.lastUpdatedAt);
        case "Bid Deadline (desc)": return ts(b.bidDeadline) - ts(a.bidDeadline);
        case "Size MW (desc)": return (b.powerMW ?? 0) - (a.powerMW ?? 0);
        case "Size MWh (desc)": return (b.energyMWh ?? 0) - (a.energyMWh ?? 0);
        default: return 0;
      }
    });
    return result;
  }, [tenders, search, category, authority, awardFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice(pageStart, pageEnd);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />

      <div className="sidebar-content sticky top-0 z-40 bg-white border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900 mr-2">Archives</h1>
          <input
            type="text"
            placeholder="Search NIT, authority, winner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {CATEGORIES.map((c) => (<option key={c}>{c}</option>))}
          </select>
          <select value={authority} onChange={(e) => setAuthority(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {AUTHORITIES.map((a) => (<option key={a}>{a}</option>))}
          </select>
          <select value={awardFilter} onChange={(e) => setAwardFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {AWARD_FILTER.map((a) => (<option key={a}>{a}</option>))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {SORT_OPTIONS.map((s) => (<option key={s}>{s}</option>))}
          </select>
          <span className="text-sm text-gray-400 ml-auto">
            {filtered.length === 0
              ? `0 of ${tenders.length} archived`
              : `Showing ${pageStart + 1}\u2013${pageEnd} of ${filtered.length}${filtered.length !== tenders.length ? ` (filtered from ${tenders.length})` : ""}`}
          </span>
        </div>
      </div>

      <div className="sidebar-content px-6 py-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (<div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />))}
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <div className="text-red-600 mb-3">{error}</div>
            <button
              onClick={loadTenders}
              className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No archived tenders match your filters</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-3 whitespace-nowrap">NIT Number</th>
                  <th className="px-3 py-3">Authority</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3 text-right">MW</th>
                  <th className="px-3 py-3 text-right">MWh</th>
                  <th className="px-3 py-3">Closed On</th>
                  <th className="px-3 py-3">Awarded To</th>
                  <th className="px-3 py-3">Developer</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((t) => (
                  <tr
                    key={t.nitNumber}
                    onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}?from=/archives`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors text-gray-600"
                  >
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap" title={t.nitNumber}>
                      {truncate(t.nitNumber, 25)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${authorityColor(t.authority)}`}>
                        {t.authority || "\u2014"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${categoryColor(t.category)}`}>
                        {t.category || "\u2014"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs" title={t.title || ""}>
                      {truncate(t.title, 60)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {t.powerMW != null ? t.powerMW.toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {t.energyMWh != null ? t.energyMWh.toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs">{formatDate(t.bidDeadline)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {t.awardedTo ? (
                        <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full text-xs font-medium">
                          {t.awardedTo}
                        </span>
                      ) : (
                        <span className="text-gray-400">{"\u2014"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {t.developedBy || <span className="text-gray-400">{"\u2014"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="text-gray-500">Page {currentPage} of {totalPages}</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                &laquo; First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Last &raquo;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ArchivesPage() {
  return <AuthGuard><ArchivesContent /></AuthGuard>;
}
