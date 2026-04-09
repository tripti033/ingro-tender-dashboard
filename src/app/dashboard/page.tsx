"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { type User } from "firebase/auth";
import { onAuthChange } from "@/lib/auth";
import { getTenders, getAlerts, updateFlag, type Tender, type Alert } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Navbar from "@/components/Navbar";

const AUTHORITIES = [
  "All",
  "SECI",
  "NTPC",
  "GUVNL",
  "MSEDCL",
  "SJVNL",
  "TNGECL",
  "UJVNL",
  "Others",
];
const CATEGORIES = ["All", "Standalone", "FDRE", "S+S", "PSP", "Hybrid"];
const STATUSES = ["All", "Active", "Closing Soon", "Closed"];
const SORT_OPTIONS = [
  "Days Left (asc)",
  "Bid Deadline (asc)",
  "Size MW (desc)",
  "Recently Added",
];
const FLAG_OPTIONS = [
  "\u2014",
  "Watching",
  "Applying",
  "Not Interested",
  "Don\u2019t Qualify",
  "Expired",
];

function authorityBadgeColor(auth: string | null): string {
  switch (auth) {
    case "SECI":
      return "bg-blue-100 text-blue-800";
    case "NTPC":
      return "bg-orange-100 text-orange-800";
    case "GUVNL":
      return "bg-green-100 text-green-800";
    case "MSEDCL":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function daysLeftDisplay(days: number | null) {
  if (days === null) return <span className="text-gray-400">&mdash;</span>;
  if (days < 0)
    return <span className="line-through text-gray-400">Closed</span>;
  if (days <= 7) return <span className="text-red-600 font-bold">{days}d</span>;
  if (days <= 30) return <span className="text-amber-600">{days}d</span>;
  return <span className="text-gray-600">{days}d</span>;
}

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "\u2014";
  }
}

function truncate(str: string | null, max: number): string {
  if (!str) return "\u2014";
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

function DashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [authority, setAuthority] = useState("All");
  const [status, setStatus] = useState("All");
  const [sortBy, setSortBy] = useState("Days Left (asc)");
  const [hideClosed, setHideClosed] = useState(false);

  useEffect(() => {
    return onAuthChange(setUser);
  }, []);

  useEffect(() => {
    Promise.all([
      getTenders().then(setTenders),
      getAlerts().then(setAlerts).catch(() => {}),
    ])
      .catch(() => setError("Failed to load tenders. Please refresh."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = [...tenders];

    // Hide closed
    if (hideClosed) {
      result = result.filter((t) => t.tenderStatus !== "closed");
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(q) ||
          (t.authority || "").toLowerCase().includes(q) ||
          (t.nitNumber || "").toLowerCase().includes(q)
      );
    }

    // Category filter
    if (category !== "All") {
      result = result.filter((t) => t.category === category);
    }

    // Authority filter
    if (authority !== "All") {
      if (authority === "Others") {
        const known = AUTHORITIES.filter((a) => a !== "All" && a !== "Others");
        result = result.filter((t) => !known.includes(t.authority || ""));
      } else {
        result = result.filter((t) => t.authority === authority);
      }
    }

    // Status filter
    if (status !== "All") {
      if (status === "Active")
        result = result.filter((t) => t.tenderStatus === "active");
      else if (status === "Closing Soon")
        result = result.filter((t) => t.tenderStatus === "closing_soon");
      else if (status === "Closed")
        result = result.filter((t) => t.tenderStatus === "closed");
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "Days Left (asc)":
          return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
        case "Bid Deadline (asc)": {
          const aDate = a.bidDeadline
            ? typeof a.bidDeadline.toDate === "function"
              ? a.bidDeadline.toDate().getTime()
              : 0
            : Infinity;
          const bDate = b.bidDeadline
            ? typeof b.bidDeadline.toDate === "function"
              ? b.bidDeadline.toDate().getTime()
              : 0
            : Infinity;
          return aDate - bDate;
        }
        case "Size MW (desc)":
          return (b.powerMW ?? 0) - (a.powerMW ?? 0);
        case "Recently Added": {
          const aTime = a.firstSeenAt
            ? typeof a.firstSeenAt.toDate === "function"
              ? a.firstSeenAt.toDate().getTime()
              : 0
            : 0;
          const bTime = b.firstSeenAt
            ? typeof b.firstSeenAt.toDate === "function"
              ? b.firstSeenAt.toDate().getTime()
              : 0
            : 0;
          return bTime - aTime;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [tenders, search, category, authority, status, sortBy, hideClosed]);

  const handleFlagChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
    tender: Tender
  ) => {
    e.stopPropagation();
    if (!user) return;
    const flag = e.target.value;
    try {
      await updateFlag(tender.nitNumber, user.uid, flag);
      setTenders((prev) =>
        prev.map((t) =>
          t.nitNumber === tender.nitNumber
            ? { ...t, flags: { ...t.flags, [user.uid]: flag } }
            : t
        )
      );
    } catch {
      // Silently fail — flag will revert on next load
    }
  };

  const getUserFlag = (tender: Tender): string => {
    if (!user || !tender.flags) return "\u2014";
    return tender.flags[user.uid] || "\u2014";
  };

  const getRowStyle = (tender: Tender): string => {
    const flag = getUserFlag(tender);
    if (flag === "Applying") return "bg-green-50";
    if (flag === "Not Interested" || flag === "Don\u2019t Qualify")
      return "opacity-60";
    return "";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* Filter bar */}
      <div className="sticky top-[52px] z-40 bg-white border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search title, authority, NIT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            {AUTHORITIES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
              className="rounded"
            />
            Hide Closed
          </label>
          <span className="text-sm text-gray-400 ml-auto">
            Showing {filtered.length} of {tenders.length} tenders
          </span>
        </div>
      </div>

      {/* Alerts bar — Mercom industry news */}
      {alerts.length > 0 && (
        <div className="mx-6 mt-4">
          <button
            onClick={() => setAlertsOpen(!alertsOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-t-lg px-4 py-2 w-full text-left hover:bg-amber-100 transition-colors"
          >
            <span className="text-amber-500">&#9889;</span>
            Industry Alerts
            <span className="text-xs font-normal text-amber-600 ml-1">
              ({alerts.length})
            </span>
            <span className="ml-auto text-xs text-amber-400">
              {alertsOpen ? "\u25B2" : "\u25BC"}
            </span>
          </button>
          {alertsOpen && (
            <div className="border border-t-0 border-amber-200 rounded-b-lg bg-white divide-y divide-amber-100">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="px-4 py-3 flex items-start gap-3 hover:bg-amber-50/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium leading-snug">
                      {alert.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{alert.source}</span>
                      {alert.authority && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {alert.authority}
                        </span>
                      )}
                      {alert.powerMW != null && (
                        <span>{alert.powerMW} MW</span>
                      )}
                      {alert.energyMWh != null && (
                        <span>{alert.energyMWh} MWh</span>
                      )}
                      {alert.publishedAt && (
                        <span>
                          {formatDate(alert.publishedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {alert.sourceUrl && (
                    <a
                      href={alert.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#0D1F3C] hover:underline whitespace-nowrap shrink-0"
                    >
                      Read &rarr;
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="h-12 bg-gray-100 rounded animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            No tenders match your filters
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500 font-medium">
                  <th className="px-4 py-3">NIT Number</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Authority</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Bid Deadline</th>
                  <th className="px-4 py-3">Days Left</th>
                  <th className="px-4 py-3">Flag</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((tender) => (
                  <tr
                    key={tender.nitNumber}
                    onClick={() =>
                      router.push(`/tender/${encodeURIComponent(tender.nitNumber)}`)
                    }
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${getRowStyle(tender)}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs" title={tender.nitNumber}>
                      {truncate(tender.nitNumber, 20)}
                    </td>
                    <td className="px-4 py-3" title={tender.title}>
                      {truncate(tender.title, 40)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${authorityBadgeColor(tender.authority)}`}
                      >
                        {tender.authority || "\u2014"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {tender.category || "\u2014"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tender.powerMW != null || tender.energyMWh != null ? (
                        <>
                          {tender.powerMW != null
                            ? `${tender.powerMW} MW`
                            : "\u2014"}{" "}
                          /{" "}
                          {tender.energyMWh != null
                            ? `${tender.energyMWh} MWh`
                            : "\u2014"}
                        </>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(tender.bidDeadline)}
                    </td>
                    <td className="px-4 py-3">
                      {daysLeftDisplay(tender.daysLeft)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={getUserFlag(tender)}
                        onChange={(e) => handleFlagChange(e, tender)}
                        className="border rounded px-2 py-1 text-xs focus:outline-none"
                      >
                        {FLAG_OPTIONS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/tender/${encodeURIComponent(tender.nitNumber)}`
                          );
                        }}
                        className="text-[#0D1F3C] hover:underline text-xs font-medium"
                      >
                        View
                      </button>
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
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
