"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { type User } from "firebase/auth";
import { onAuthChange } from "@/lib/auth";
import { getTenders, updateFlag, markAsRead, toggleRead, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const AUTHORITIES = [
  "All", "SECI", "NTPC", "GUVNL", "MSEDCL", "RRVUNL", "UJVNL",
  "TNGECL", "SJVNL", "DHBVN", "WBSEDCL", "MSETCL", "GeM", "Others",
];
const CATEGORIES = ["All", "Standalone", "FDRE", "S+S", "PSP", "Hybrid", "Pump Storage Plant"];
const STATUSES = ["All", "Active", "Closing Soon"];
const SORT_OPTIONS = [
  "Days Left (asc)",
  "Bid Deadline (asc)",
  "Size MW (desc)",
  "Size MWh (desc)",
  "Recently Added",
];
const FLAG_OPTIONS = [
  "\u2014", "Watching", "Applying", "Not Interested", "Don\u2019t Qualify", "Expired",
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
  return colors[auth || ""] || "bg-gray-800 text-gray-300";
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
  return colors[cat || ""] || "bg-gray-800 text-gray-300";
}

function daysLeftDisplay(days: number | null) {
  if (days === null) return <span className="text-gray-400">&mdash;</span>;
  if (days < 0) return <span className="line-through text-gray-400">Closed</span>;
  if (days <= 7) return <span className="text-red-600 font-bold">{days}d</span>;
  if (days <= 30) return <span className="text-amber-600 font-semibold">{days}d</span>;
  return <span className="text-gray-600">{days}d</span>;
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

function formatINR(val: number | null): string {
  if (val == null) return "\u2014";
  if (val >= 10000000) return `\u20B9${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `\u20B9${(val / 100000).toFixed(2)} L`;
  return `\u20B9${val.toLocaleString("en-IN")}`;
}

function truncate(str: string | null, max: number): string {
  if (!str) return "\u2014";
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

// Derive a fresh daysLeft from bidDeadline so client-side "active" /
// "closing soon" filters don't depend on a value stamped hours ago.
function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  try {
    const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  } catch { return t.daysLeft ?? null; }
}

function liveStatus(t: Tender): "active" | "closing_soon" | "closed" | "awarded" | "cancelled" {
  if (t.tenderStatus === "awarded") return "awarded";
  if (t.tenderStatus === "cancelled") return "cancelled";
  const days = liveDaysLeft(t);
  if (days != null && days < 0) return "closed";
  if (days != null && days <= 7) return "closing_soon";
  return "active";
}

function DashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [authority, setAuthority] = useState("All");
  const [status, setStatus] = useState("All");
  const [sortBy, setSortBy] = useState("Recently Added");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => { return onAuthChange(setUser); }, []);

  const loadTenders = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTenders();
      setTenders(data);
    } catch {
      // One silent retry to dodge the auth-token-not-ready race
      try {
        await new Promise((r) => setTimeout(r, 800));
        const data = await getTenders();
        setTenders(data);
      } catch {
        setError("Failed to load tenders.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [search, category, authority, status, sortBy]);

  const filtered = useMemo(() => {
    // Exclude anything that belongs in /archives: closed, awarded, cancelled,
    // or whose deadline has passed (stale status field).
    let result = tenders.filter((t) => {
      if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return false;
      if (liveStatus(t) === "closed") return false;
      return true;
    });
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        [t.title, t.authority, t.nitNumber, t.location, t.category]
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
    if (status === "Active") result = result.filter((t) => liveStatus(t) === "active");
    else if (status === "Closing Soon") result = result.filter((t) => liveStatus(t) === "closing_soon");

    result.sort((a, b) => {
      switch (sortBy) {
        case "Days Left (asc)": return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
        case "Bid Deadline (asc)": {
          const ad = a.bidDeadline ? (typeof a.bidDeadline.toDate === "function" ? a.bidDeadline.toDate().getTime() : 0) : Infinity;
          const bd = b.bidDeadline ? (typeof b.bidDeadline.toDate === "function" ? b.bidDeadline.toDate().getTime() : 0) : Infinity;
          return ad - bd;
        }
        case "Size MW (desc)": return (b.powerMW ?? 0) - (a.powerMW ?? 0);
        case "Size MWh (desc)": return (b.energyMWh ?? 0) - (a.energyMWh ?? 0);
        case "Recently Added": {
          const at = a.firstSeenAt ? (typeof a.firstSeenAt.toDate === "function" ? a.firstSeenAt.toDate().getTime() : 0) : 0;
          const bt = b.firstSeenAt ? (typeof b.firstSeenAt.toDate === "function" ? b.firstSeenAt.toDate().getTime() : 0) : 0;
          return bt - at;
        }
        default: return 0;
      }
    });
    return result;
  }, [tenders, search, category, authority, status, sortBy]);

  // Auto-drafts created by `scraper/llm-alerts.js` use `DRAFT-<ts>` as the
  // doc ID. They're real records but not real tenders yet — keep them out
  // of the main paginated table and surface them in a separate group below.
  const isAlertDraft = (t: Tender) => t.nitNumber.startsWith("DRAFT-");
  const mainTenders = useMemo(() => filtered.filter((t) => !isAlertDraft(t)), [filtered]);
  const alertDrafts = useMemo(() => filtered.filter(isAlertDraft), [filtered]);

  const totalPages = Math.max(1, Math.ceil(mainTenders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, mainTenders.length);
  const pageRows = mainTenders.slice(pageStart, pageEnd);

  const handleFlagChange = async (e: React.ChangeEvent<HTMLSelectElement>, tender: Tender) => {
    e.stopPropagation();
    if (!user) return;
    const flag = e.target.value;
    try {
      await updateFlag(tender.nitNumber, user.uid, flag, user.email || "", tender.title || "");
      setTenders((prev) => prev.map((t) =>
        t.nitNumber === tender.nitNumber ? { ...t, flags: { ...t.flags, [user.uid]: flag } } : t
      ));
    } catch { /* will revert on next load */ }
  };

  const getUserFlag = (tender: Tender): string => {
    if (!user || !tender.flags) return "\u2014";
    return tender.flags[user.uid] || "\u2014";
  };

  const getRowStyle = (tender: Tender): string => {
    const flag = getUserFlag(tender);
    if (flag === "Applying") return "bg-green-50";
    if (flag === "Not Interested" || flag === "Don\u2019t Qualify") return "opacity-60";
    return "";
  };

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />

      {/* Filter bar */}
      <div className="sidebar-content sticky top-0 z-40 bg-[var(--bg-card)] border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search NIT, authority, location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
          />
          <div className="flex flex-col">
            <label className="text-[10px] text-gray-400 uppercase tracking-wider pl-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              {CATEGORIES.map((c) => (<option key={c}>{c}</option>))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-gray-400 uppercase tracking-wider pl-1">Authority</label>
            <select value={authority} onChange={(e) => setAuthority(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              {AUTHORITIES.map((a) => (<option key={a}>{a}</option>))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-gray-400 uppercase tracking-wider pl-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              {STATUSES.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-gray-400 uppercase tracking-wider pl-1">Sort by</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              {SORT_OPTIONS.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </div>
          <span className="text-sm text-gray-400 ml-auto">
            {mainTenders.length === 0
              ? `0 of ${tenders.length}`
              : `Showing ${pageStart + 1}\u2013${pageEnd} of ${mainTenders.length}${mainTenders.length !== tenders.length ? ` (filtered from ${tenders.length})` : ""}`}
            {alertDrafts.length > 0 && ` \u00b7 ${alertDrafts.length} draft${alertDrafts.length === 1 ? "" : "s"}`}
          </span>
          <button onClick={() => router.push("/tender/new")}
            className="bg-[#0D1F3C] text-white px-3 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors">
            + New Tender
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="sidebar-content px-6 py-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (<div key={i} className="h-12 bg-gray-800 rounded animate-pulse" />))}
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
        ) : mainTenders.length === 0 && alertDrafts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No tenders match your filters</div>
        ) : mainTenders.length === 0 ? null : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-subtle)] text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-1 py-3 w-6"></th>
                  <th className="px-3 py-3 whitespace-nowrap">NIT Number</th>
                  <th className="px-3 py-3">Authority</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3">Mode</th>
                  <th className="px-3 py-3 text-right">MW</th>
                  <th className="px-3 py-3 text-right">MWh</th>
                  <th className="px-3 py-3">Connectivity</th>
                  <th className="px-3 py-3">Bid Deadline</th>
                  <th className="px-3 py-3">Days Left</th>
                  <th className="px-3 py-3 text-right">EMD</th>
                  <th className="px-3 py-3 text-right">Total Cost</th>
                  <th className="px-3 py-3">Assigned</th>
                  <th className="px-3 py-3">Flag</th>
                  <th className="px-3 py-3">Docs</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((t) => (
                  <tr
                    key={t.nitNumber}
                    onClick={() => {
                      if (user && (!t.readBy || !t.readBy[user.uid])) {
                        markAsRead(t.nitNumber, user.uid);
                        setTenders(prev => prev.map(x => x.nitNumber === t.nitNumber ? { ...x, readBy: { ...x.readBy, [user.uid]: Date.now() } } : x));
                      }
                      router.push(`/tender/${encodeURIComponent(t.nitNumber)}`);
                    }}
                    className={`hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors ${getRowStyle(t)} ${
                      user && (!t.readBy || !t.readBy[user.uid]) ? "font-semibold" : "font-normal text-gray-600"
                    }`}
                  >
                    <td className="px-1.5 py-2.5 w-8 text-center" onClick={(e) => {
                      e.stopPropagation();
                      if (!user) return;
                      const isRead = !!(t.readBy && t.readBy[user.uid]);
                      toggleRead(t.nitNumber, user.uid, !isRead);
                      setTenders(prev => prev.map(x => x.nitNumber === t.nitNumber
                        ? { ...x, readBy: { ...x.readBy, [user.uid]: isRead ? undefined as unknown as number : Date.now() } }
                        : x));
                    }}>
                      {user && (t.readBy && t.readBy[user.uid]) ? (
                        <svg className="w-4 h-4 text-gray-300 hover:text-gray-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Mark as unread">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-[#0D1F3C] hover:text-blue-600 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Mark as read">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap" title={t.nitNumber}>
                      {truncate(t.nitNumber, 25)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${authorityColor(t.authority)}`}>
                        {t.authority || "\u2014"}
                      </span>
                      {t.isCorrigendum && (
                        <span className="ml-1 inline-block bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full text-[10px] font-bold" title="Corrigendum">CORR</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${categoryColor(t.category)}`}>
                        {t.category || "\u2014"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs" title={t.location || ""}>
                      {truncate(t.location, 18)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{t.tenderMode || "\u2014"}</td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {t.powerMW != null ? t.powerMW.toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {t.energyMWh != null ? t.energyMWh.toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{t.connectivityType || "\u2014"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs">{formatDate(t.bidDeadline)}</td>
                    <td className="px-3 py-2.5">{daysLeftDisplay(liveDaysLeft(t))}</td>
                    <td className="px-3 py-2.5 text-right text-xs">{formatINR(t.emdAmount)}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-medium">{formatINR(t.totalCost)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {t.assignedTo ? <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full text-xs">{t.assignedTo}</span> : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={getUserFlag(t)}
                        onChange={(e) => handleFlagChange(e, t)}
                        className="border rounded px-1.5 py-1 text-xs focus:outline-none"
                      >
                        {FLAG_OPTIONS.map((f) => (<option key={f} value={f}>{f}</option>))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      {t.documentLink && (
                        <a
                          href={t.documentLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#0D1F3C] hover:underline text-xs font-medium"
                        >
                          View
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && mainTenders.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="text-gray-500">Page {currentPage} of {totalPages}</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                &laquo; First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Last &raquo;
              </button>
            </div>
          </div>
        )}

        {/* Alert auto-drafts: separated so they don't get mixed into the
            real-tenders table. These were created by `scraper/llm-alerts.js`
            from high-relevance news items the LLM flagged as tender
            announcements — they need a human pass before being promoted. */}
        {!loading && !error && alertDrafts.length > 0 && (
          <div className="mt-8 bg-[var(--bg-card)] rounded-lg border p-5">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-100">Drafts from alerts</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Auto-flagged by the alerts scanner. Open one to fill in the missing fields and promote it to a real tender.
                </p>
              </div>
              <span className="text-xs text-gray-400">{alertDrafts.length} pending review</span>
            </div>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-subtle)] text-left text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Authority</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2 text-right">MW</th>
                    <th className="px-3 py-2 text-right">MWh</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {alertDrafts.map((t) => (
                    <tr
                      key={t.nitNumber}
                      onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}`)}
                      className="hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5 max-w-md">
                        <div className="text-gray-100 truncate" title={t.title || ""}>{truncate(t.title, 90)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{t.authority || "—"}</td>
                      <td className="px-3 py-2.5 text-xs">{t.state || "—"}</td>
                      <td className="px-3 py-2.5 text-right text-xs">{t.powerMW != null ? t.powerMW.toLocaleString() : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-xs">{t.energyMWh != null ? t.energyMWh.toLocaleString() : "—"}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {t.sourceUrl ? (
                          <a
                            href={t.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#0D1F3C] hover:underline"
                          >
                            View article
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <AuthGuard><DashboardContent /></AuthGuard>;
}
