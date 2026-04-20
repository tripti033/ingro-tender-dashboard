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

  useEffect(() => { return onAuthChange(setUser); }, []);

  useEffect(() => {
    getTenders()
      .then(setTenders)
      .catch(() => setError("Failed to load tenders. Please refresh."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = tenders.filter((t) => t.tenderStatus !== "closed");
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
    if (status === "Active") result = result.filter((t) => t.tenderStatus === "active");
    else if (status === "Closing Soon") result = result.filter((t) => t.tenderStatus === "closing_soon");

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
    <div className="min-h-screen bg-gray-50">
      <Sidebar />

      {/* Filter bar */}
      <div className="sidebar-content sticky top-0 z-40 bg-white border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search NIT, authority, location..."
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
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {STATUSES.map((s) => (<option key={s}>{s}</option>))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {SORT_OPTIONS.map((s) => (<option key={s}>{s}</option>))}
          </select>
          <span className="text-sm text-gray-400 ml-auto">
            Showing {filtered.length} of {tenders.length} tenders
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
            {[...Array(8)].map((_, i) => (<div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No tenders match your filters</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
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
                {filtered.map((t) => (
                  <tr
                    key={t.nitNumber}
                    onClick={() => {
                      if (user && (!t.readBy || !t.readBy[user.uid])) {
                        markAsRead(t.nitNumber, user.uid);
                        setTenders(prev => prev.map(x => x.nitNumber === t.nitNumber ? { ...x, readBy: { ...x.readBy, [user.uid]: Date.now() } } : x));
                      }
                      router.push(`/tender/${encodeURIComponent(t.nitNumber)}`);
                    }}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${getRowStyle(t)} ${
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
                    <td className="px-3 py-2.5">{daysLeftDisplay(t.daysLeft)}</td>
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
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <AuthGuard><DashboardContent /></AuthGuard>;
}
