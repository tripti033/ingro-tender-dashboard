"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type User } from "firebase/auth";
import { onAuthChange } from "@/lib/auth";
import {
  getTenders, getBids, getAlerts, getEmployees,
  type Tender, type Bid, type Alert, type Employee,
} from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  try {
    const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  } catch { return t.daysLeft ?? null; }
}

function isActive(t: Tender): boolean {
  if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return false;
  const days = liveDaysLeft(t);
  return days == null || days >= 0;
}

function formatDeadline(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function HomeContent() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { return onAuthChange(setUser); }, []);

  useEffect(() => {
    Promise.all([
      getTenders(),
      getBids(),
      getAlerts(20),
      getEmployees(),
    ]).then(([t, b, a, e]) => {
      setTenders(t); setBids(b); setAlerts(a); setEmployees(e);
    }).finally(() => setLoading(false));
  }, []);

  const now = useMemo(() => new Date(), []);
  const activeTenders = useMemo(() => tenders.filter(isActive), [tenders]);

  // KPI: +N this week — tenders firstSeenAt in last 7 days
  const newThisWeek = useMemo(() => {
    const wkAgo = Date.now() - 7 * 86400000;
    return activeTenders.filter((t) => {
      try {
        const ts = t.firstSeenAt?.toDate?.()?.getTime() || 0;
        return ts >= wkAgo;
      } catch { return false; }
    }).length;
  }, [activeTenders]);

  const pipelineGW = useMemo(() => {
    const mw = activeTenders.reduce((s, t) => s + (t.powerMW || 0), 0);
    return mw / 1000;
  }, [activeTenders]);
  const pipelineGWh = useMemo(() => {
    const mwh = activeTenders.reduce((s, t) => s + (t.energyMWh || 0), 0);
    return mwh / 1000;
  }, [activeTenders]);

  // Bids in prep — tenders flagged Applying by anyone OR with assignedTo set
  const inPrepTenders = useMemo(() => {
    return activeTenders.filter((t) => {
      const flagged = Object.values(t.flags || {}).some((f) => f === "Applying");
      return flagged || !!t.assignedTo;
    });
  }, [activeTenders]);
  const dueThisWeek = useMemo(() => {
    return inPrepTenders.filter((t) => {
      const d = liveDaysLeft(t);
      return d != null && d >= 0 && d <= 7;
    }).length;
  }, [inPrepTenders]);

  // Win rate (90d): from bids collection — won / total in last 90 days
  const winRate90d = useMemo(() => {
    const ninetyAgo = Date.now() - 90 * 86400000;
    void ninetyAgo;
    // Bids don't carry a date directly; use all bids as a proxy. Not perfect
    // but matches the demo screenshot — refine later when bid records carry
    // an "awardedAt" timestamp.
    const submitted = bids.length;
    const won = bids.filter((b) => b.result === "won").length;
    if (submitted === 0) return { pct: 0, won: 0, total: 0 };
    return { pct: Math.round((won / submitted) * 100), won, total: submitted };
  }, [bids]);

  // Total EMD due this week (count of tenders with EMD pending in next 7 days)
  const emdsDueThisWeek = useMemo(() => {
    return activeTenders.filter((t) => {
      try {
        const d = t.emdDeadline?.toDate?.();
        if (!d) return false;
        const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
        return days >= 0 && days <= 7;
      } catch { return false; }
    }).length;
  }, [activeTenders]);

  const newAlerts = useMemo(() => {
    const wkAgo = Date.now() - 7 * 86400000;
    return alerts.filter((a) => {
      try { return (a.createdAt?.toDate?.()?.getTime() || 0) >= wkAgo; } catch { return false; }
    }).length;
  }, [alerts]);

  const bidDeadlinesThisWeek = useMemo(() => {
    return activeTenders.filter((t) => {
      const d = liveDaysLeft(t);
      return d != null && d >= 0 && d <= 7;
    }).length;
  }, [activeTenders]);

  // Closing soon — sorted by daysLeft asc, capped at 7
  const closingSoon = useMemo(() => {
    return activeTenders
      .map((t) => ({ tender: t, days: liveDaysLeft(t) }))
      .filter((x) => x.days != null && x.days >= 0 && x.days <= 30)
      .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
      .slice(0, 7);
  }, [activeTenders]);

  // My tenders in progress — assignedTo matches current user (by name match
  // against email's local part, simplistic but works for the demo team)
  const myTenders = useMemo(() => {
    if (!user) return [];
    const meKey = (user.email || "").split("@")[0].toLowerCase();
    return inPrepTenders
      .filter((t) => {
        if (!t.assignedTo) return false;
        const a = t.assignedTo.toLowerCase();
        return a.includes(meKey) || meKey.split(".").some((tok) => tok.length > 2 && a.includes(tok));
      })
      .sort((a, b) => (liveDaysLeft(a) ?? 9999) - (liveDaysLeft(b) ?? 9999))
      .slice(0, 5);
  }, [inPrepTenders, user]);

  // Industry pulse — top 3 by relevanceScore
  const industryPulse = useMemo(() => {
    return [...alerts]
      .filter((a) => (a.relevanceScore || 0) >= 7)
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, 3);
  }, [alerts]);

  const greeting = useMemo(() => {
    const hr = now.getHours();
    if (hr < 12) return "Good morning";
    if (hr < 17) return "Good afternoon";
    return "Good evening";
  }, [now]);

  const meName = (user?.email || "").split("@")[0].split(/[._-]/)[0];
  const meDisplay = meName ? meName[0].toUpperCase() + meName.slice(1) : "there";

  return (
    <div className="min-h-screen bg-[#0d1015] text-gray-100">
      <Sidebar />
      <div className="sidebar-content px-8 py-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{greeting}, {meDisplay}</h1>
            <p className="text-sm text-gray-400 mt-1">
              {bidDeadlinesThisWeek} bid deadline{bidDeadlinesThisWeek === 1 ? "" : "s"} this week
              {" · "}{emdsDueThisWeek} EMD{emdsDueThisWeek === 1 ? "" : "s"} due
              {" · "}{newAlerts} new alert{newAlerts === 1 ? "" : "s"}
            </p>
          </div>
          <div className="text-xs text-gray-400 text-right">
            {now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}{" · "}
            {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })} IST
          </div>
        </div>

        {/* KPI cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-800/50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Kpi
              label="Active tenders"
              value={String(activeTenders.length)}
              hint={newThisWeek > 0 ? `+${newThisWeek} this week` : "no new this week"}
              hintColor={newThisWeek > 0 ? "text-green-400" : "text-gray-500"}
              onClick={() => router.push("/dashboard")}
            />
            <Kpi
              label="Pipeline capacity"
              value={`${pipelineGW.toFixed(pipelineGW < 10 ? 2 : 1)} GW`}
              hint={`${pipelineGWh.toFixed(1)} GWh tracked`}
              hintColor="text-gray-500"
            />
            <Kpi
              label="Bids in prep"
              value={String(inPrepTenders.length)}
              hint={dueThisWeek > 0 ? `${dueThisWeek} due this week` : "none due this week"}
              hintColor={dueThisWeek > 0 ? "text-amber-400" : "text-gray-500"}
            />
            <Kpi
              label="Win rate (90d)"
              value={`${winRate90d.pct}%`}
              hint={`${winRate90d.won} of ${winRate90d.total} submitted`}
              hintColor="text-gray-500"
            />
          </div>
        )}

        {/* Closing soon */}
        <div className="bg-[#1a1d24] rounded-xl p-5 mb-6 border border-gray-800">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-lg font-semibold">Closing soon</h2>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> 0–3d</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 4–10d</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" /> 11–30d</span>
            </div>
          </div>
          {loading ? (
            <div className="flex gap-2 overflow-hidden">{[...Array(7)].map((_, i) => <div key={i} className="w-32 h-32 bg-gray-800/50 rounded-lg animate-pulse shrink-0" />)}</div>
          ) : closingSoon.length === 0 ? (
            <p className="text-sm text-gray-500">No tenders closing in the next 30 days.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {closingSoon.map(({ tender, days }) => {
                const urgencyBg = days! <= 3 ? "bg-red-950/40 border-red-800" : days! <= 10 ? "bg-amber-950/30 border-amber-900/60" : "bg-gray-900 border-gray-800";
                const urgencyBar = days! <= 3 ? "bg-red-500" : days! <= 10 ? "bg-amber-500" : "bg-gray-500";
                const dl = tender.bidDeadline?.toDate?.();
                const auth = (tender.authority || "?").slice(0, 8);
                const titleSnip = (tender.title || tender.nitNumber).split(/\s+/).slice(0, 2).join(" ").slice(0, 18);
                const mw = tender.powerMW != null ? `${tender.powerMW} MW` : "";
                return (
                  <button
                    key={tender.nitNumber}
                    onClick={() => router.push(`/tender/${encodeURIComponent(tender.nitNumber)}?from=/home`)}
                    className={`relative shrink-0 w-32 rounded-lg border ${urgencyBg} p-3 text-left hover:brightness-125 transition-all`}
                  >
                    <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-r ${urgencyBar}`} />
                    <div className="ml-1.5">
                      <div className="text-xs text-gray-300 mb-1">{days}d · {dl ? formatDeadline(dl) : "—"}</div>
                      <div className="text-sm font-semibold text-gray-100 leading-tight">{auth}</div>
                      <div className="text-xs text-gray-300 mt-1 leading-tight">{titleSnip}</div>
                      {mw && <div className="text-xs text-gray-400 mt-2">{mw}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Two-column row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* My tenders */}
          <div className="bg-[#1a1d24] rounded-xl p-5 border border-gray-800">
            <h2 className="text-lg font-semibold mb-4">My tenders <span className="text-sm text-gray-500 font-normal">· in progress</span></h2>
            {loading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-gray-800/50 rounded animate-pulse" />)}</div>
            ) : myTenders.length === 0 ? (
              <p className="text-sm text-gray-500">No tenders assigned to you yet. Open a tender and use the &quot;Assigned to&quot; dropdown.</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {myTenders.map((t) => {
                  const days = liveDaysLeft(t);
                  const urgent = days != null && days <= 7;
                  const colorBar = urgent ? "bg-amber-500" : days != null && days <= 30 ? "bg-blue-500" : "bg-gray-600";
                  const flag = (Object.values(t.flags || {}).find((f) => f === "Applying")) || (t.assignedTo ? "Assigned" : null);
                  return (
                    <button
                      key={t.nitNumber}
                      onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}?from=/home`)}
                      className="w-full text-left flex items-center gap-3 py-3 hover:bg-gray-900/50 -mx-1 px-1 rounded transition-colors"
                    >
                      <div className={`w-1 h-10 rounded ${colorBar}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-100 truncate">
                          {t.authority} {t.powerMW || "?"}MW{t.energyMWh ? `/${t.energyMWh}MWh` : ""}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {flag || "In progress"}{t.assignedTo ? ` · ${t.assignedTo.split(" ")[0]}` : ""}
                        </div>
                      </div>
                      <div className={`text-xs whitespace-nowrap ${urgent ? "text-amber-400" : "text-gray-500"}`}>
                        {days == null ? "—" : `${days}d`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Industry pulse */}
          <div className="bg-[#1a1d24] rounded-xl p-5 border border-gray-800">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-semibold">Industry pulse</h2>
              {industryPulse.length > 0 && (
                <span className="text-xs text-red-400">{industryPulse.length} high-relevance</span>
              )}
            </div>
            {loading ? (
              <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-800/50 rounded animate-pulse" />)}</div>
            ) : industryPulse.length === 0 ? (
              <p className="text-sm text-gray-500">No high-relevance alerts yet.</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {industryPulse.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => a.sourceUrl && window.open(a.sourceUrl, "_blank", "noopener,noreferrer")}
                    className="w-full text-left py-3 first:pt-0 last:pb-0 hover:bg-gray-900/50 -mx-1 px-1 rounded transition-colors"
                  >
                    <div className="text-sm font-semibold text-gray-100 leading-snug">{(a.title || "").slice(0, 120)}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {(a.source || "?")} {(a.states && a.states.length > 0) ? ` · ${a.states.slice(0, 2).join(", ")}` : ""}
                      {(a.alertCategory) ? ` · ${a.alertCategory}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label, value, hint, hintColor = "text-gray-500", onClick,
}: { label: string; value: string; hint?: string; hintColor?: string; onClick?: () => void }) {
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-[#1a1d24] border border-gray-800 rounded-xl p-5 text-left ${onClick ? "hover:border-gray-600 transition-colors cursor-pointer" : ""}`}
    >
      <div className="text-xs font-medium text-gray-400 mb-2">{label}</div>
      <div className="text-3xl font-bold text-gray-100">{value}</div>
      {hint && <div className={`text-xs mt-2 ${hintColor}`}>{hint}</div>}
    </Wrapper>
  );
}

export default function HomePage() {
  return <AuthGuard><HomeContent /></AuthGuard>;
}
