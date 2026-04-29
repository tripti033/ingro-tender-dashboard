"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getTenders, getBids, getCompanies,
  type Tender, type Bid, type Company,
} from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

type TimeRange = "90d" | "1y" | "all";

function fmtCr(rs: number | null | undefined): string {
  if (rs == null || isNaN(rs)) return "—";
  if (rs >= 10000000) return `₹${(rs / 10000000).toFixed(1)} Cr`;
  if (rs >= 100000) return `₹${(rs / 100000).toFixed(1)} L`;
  return `₹${rs.toLocaleString("en-IN")}`;
}

function fmtTariff(rs: number | null | undefined): string {
  if (rs == null || rs === 0) return "—";
  return `₹${(rs / 100000).toFixed(2)}L`;
}

function fmtMW(mw: number | null | undefined): string {
  if (mw == null) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${mw.toLocaleString("en-IN")} MW`;
}

function fmtMWh(mwh: number | null | undefined): string {
  if (mwh == null) return "—";
  if (mwh >= 1000) return `${(mwh / 1000).toFixed(1)} GWh`;
  return `${mwh.toLocaleString("en-IN")} MWh`;
}

function quarterKey(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()} Q${q}`;
}

function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  try {
    const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  } catch { return t.daysLeft ?? null; }
}

function isActive(t: Tender): boolean {
  if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return false;
  if ((t.sources || []).includes("excel-comparables-seed")) return false;
  const days = liveDaysLeft(t);
  return days == null || days >= 0;
}

function isApplying(t: Tender): boolean {
  return Object.values(t.flags || {}).some((f) => f === "Applying");
}

function isReviewed(t: Tender): boolean {
  return Object.values(t.flags || {}).some((f) => !!f && f !== "—" && f !== "");
}

function withinRange(d: Date | null, range: TimeRange): boolean {
  if (!d) return range === "all";
  const cutoff = range === "90d" ? Date.now() - 90 * 86400000
    : range === "1y" ? Date.now() - 365 * 86400000
    : 0;
  return d.getTime() >= cutoff;
}

function tsDate(ts: { toDate?: () => Date } | null | undefined): Date | null {
  if (!ts) return null;
  try { return typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string); }
  catch { return null; }
}

function AnalyticsContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>("1y");

  useEffect(() => {
    Promise.all([getTenders(), getBids(), getCompanies()])
      .then(([t, b, c]) => { setTenders(t); setBids(b); setCompanies(c); })
      .finally(() => setLoading(false));
  }, []);

  const active = useMemo(() => tenders.filter(isActive), [tenders]);

  // ── KPI strip ────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const pipelineMW = active.reduce((s, t) => s + (t.powerMW || 0), 0);
    const pipelineMWh = active.reduce((s, t) => s + (t.energyMWh || 0), 0);
    const pipelineValue = active.reduce((s, t) => s + (t.totalCost || 0), 0);
    const applyingTenders = active.filter(isApplying);
    const cashLocked = applyingTenders.reduce((s, t) => s + (t.emdAmount || 0), 0);
    const closingThisWeek = active.filter((t) => {
      const d = liveDaysLeft(t);
      return d != null && d >= 0 && d <= 7;
    }).length;
    return {
      activeCount: active.length,
      pipelineMW,
      pipelineMWh,
      pipelineValue,
      cashLocked,
      applyingCount: applyingTenders.length,
      closingThisWeek,
    };
  }, [active]);

  // ── Tariff trend (median tariff per quarter, by VGF band) ─────────────
  const tariffTrend = useMemo(() => {
    const buckets = new Map<string, { VGF1: number[]; VGF2: number[]; "No-VGF": number[]; quarter: string; ts: number }>();
    for (const t of tenders) {
      if (!t.tariffRsPerMwPerMonth) continue;
      const ad = tsDate(t.awardDate) || tsDate(t.firstSeenAt);
      if (!ad) continue;
      if (!withinRange(ad, range)) continue;
      const q = quarterKey(ad);
      const ts = ad.getTime();
      const band = t.tariffBand;
      if (!band) continue;
      if (!buckets.has(q)) buckets.set(q, { VGF1: [], VGF2: [], "No-VGF": [], quarter: q, ts });
      const bucket = buckets.get(q)!;
      if (band === "VGF1" || band === "VGF2" || band === "No-VGF") bucket[band].push(t.tariffRsPerMwPerMonth);
    }
    const median = (arr: number[]): number | null => {
      if (arr.length === 0) return null;
      const s = [...arr].sort((a, b) => a - b);
      return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    return Array.from(buckets.values())
      .sort((a, b) => a.ts - b.ts)
      .map((b) => ({
        quarter: b.quarter,
        VGF1: median(b.VGF1),
        VGF2: median(b.VGF2),
        "No-VGF": median(b["No-VGF"]),
        count: b.VGF1.length + b.VGF2.length + b["No-VGF"].length,
      }));
  }, [tenders, range]);

  // ── Authority leaderboard ─────────────────────────────────────────────
  const authorityStats = useMemo(() => {
    const map = new Map<string, { count: number; mw: number; applying: number; won: number }>();
    for (const t of tenders) {
      if ((t.sources || []).includes("excel-comparables-seed")) continue;
      const a = t.authority;
      if (!a) continue;
      const fs = tsDate(t.firstSeenAt);
      if (!withinRange(fs, range)) continue;
      if (!map.has(a)) map.set(a, { count: 0, mw: 0, applying: 0, won: 0 });
      const stat = map.get(a)!;
      stat.count++;
      stat.mw += t.powerMW || 0;
      if (isApplying(t)) stat.applying++;
      if (t.awardedTo) stat.won++;
    }
    return Array.from(map.entries())
      .map(([authority, s]) => ({ authority, ...s }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [tenders, range]);

  // ── Bid funnel ────────────────────────────────────────────────────────
  const funnel = useMemo(() => {
    const inRange = tenders.filter((t) => {
      if ((t.sources || []).includes("excel-comparables-seed")) return false;
      const fs = tsDate(t.firstSeenAt);
      return withinRange(fs, range);
    });
    const discovered = inRange.length;
    const reviewed = inRange.filter(isReviewed).length;
    const applying = inRange.filter(isApplying).length;
    const submittedNits = new Set(bids.filter((b) => b.companyName?.toLowerCase().includes("ingro") && (b.result === "won" || b.result === "lost")).map((b) => b.tenderNit));
    const submitted = inRange.filter((t) => submittedNits.has(t.nitNumber)).length;
    const wonNits = new Set(bids.filter((b) => b.companyName?.toLowerCase().includes("ingro") && b.result === "won").map((b) => b.tenderNit));
    const won = inRange.filter((t) => wonNits.has(t.nitNumber)).length;
    return [
      { stage: "Discovered", count: discovered, hint: "Total tenders surfaced" },
      { stage: "Reviewed", count: reviewed, hint: "Any flag set" },
      { stage: "Applying", count: applying, hint: "Marked Applying" },
      { stage: "Submitted", count: submitted, hint: "Bid submitted by us" },
      { stage: "Won", count: won, hint: "Awarded to Ingro" },
    ];
  }, [tenders, bids, range]);

  // ── Top winners (market intel) ────────────────────────────────────────
  const topWinners = useMemo(() => {
    return companies
      .filter((c) => c.bidsWon > 0 || c.totalCapacityMWh > 0)
      .sort((a, b) => (b.totalCapacityMWh || 0) - (a.totalCapacityMWh || 0))
      .slice(0, 8);
  }, [companies]);

  // ── Cash exposure detail (top EMD) ────────────────────────────────────
  const cashDetail = useMemo(() => {
    return active
      .filter(isApplying)
      .filter((t) => (t.emdAmount || 0) > 0)
      .sort((a, b) => (b.emdAmount || 0) - (a.emdAmount || 0))
      .slice(0, 5);
  }, [active]);

  // ── Geography ─────────────────────────────────────────────────────────
  const stateStats = useMemo(() => {
    const map = new Map<string, { count: number; mw: number }>();
    for (const t of active) {
      const s = (t.state || "").trim();
      if (!s) continue;
      if (!map.has(s)) map.set(s, { count: 0, mw: 0 });
      const st = map.get(s)!;
      st.count++;
      st.mw += t.powerMW || 0;
    }
    return Array.from(map.entries())
      .map(([state, s]) => ({ state, ...s }))
      .sort((a, b) => b.mw - a.mw)
      .slice(0, 10);
  }, [active]);

  const maxAuthCount = Math.max(1, ...authorityStats.map((a) => a.count));
  const maxStateMW = Math.max(1, ...stateStats.map((s) => s.mw));
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />

      <div className="sidebar-content sticky top-0 z-40 bg-[var(--bg-card)] border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-100">Analytics</h1>
          <span className="text-xs text-gray-400">Pipeline, market trends, team performance</span>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {(["90d", "1y", "all"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  range === r
                    ? "bg-[#0D1F3C] text-white"
                    : "text-gray-500 hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {r === "90d" ? "Last 90 days" : r === "1y" ? "Last 12 months" : "All time"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-content px-6 py-6 max-w-7xl space-y-5">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-800/50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi
                label="Active pipeline"
                value={String(kpis.activeCount)}
                hint={`${fmtMW(kpis.pipelineMW)} · ${fmtMWh(kpis.pipelineMWh)}`}
                accent="text-blue-500"
                onClick={() => router.push("/dashboard")}
              />
              <Kpi
                label="Pipeline value"
                value={fmtCr(kpis.pipelineValue)}
                hint="Sum of total project cost"
                accent="text-emerald-500"
              />
              <Kpi
                label="Cash exposure"
                value={fmtCr(kpis.cashLocked)}
                hint={`EMD across ${kpis.applyingCount} applying tender${kpis.applyingCount === 1 ? "" : "s"}`}
                accent="text-amber-500"
              />
              <Kpi
                label="Closing this week"
                value={String(kpis.closingThisWeek)}
                hint="Bids due in next 7 days"
                accent={kpis.closingThisWeek > 0 ? "text-red-500" : "text-gray-400"}
                onClick={() => router.push("/dashboard")}
              />
            </div>

            {/* Row 1: Tariff trend + Authority leaderboard */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Winning tariff — quarterly median"
                subtitle="₹/MW/Month, split by VGF band. Lower = the market is getting more competitive."
              >
                {tariffTrend.length === 0 ? (
                  <Empty hint="Need awarded tenders with tariff data in the chosen range." />
                ) : (
                  <TariffChart data={tariffTrend} />
                )}
              </Panel>

              <Panel
                title="Authority leaderboard"
                subtitle="Top 10 issuing authorities by tender volume."
              >
                {authorityStats.length === 0 ? <Empty /> : (
                  <div className="space-y-1.5">
                    {authorityStats.map((a) => {
                      const pct = (a.count / maxAuthCount) * 100;
                      return (
                        <div key={a.authority} className="flex items-center gap-2 text-xs">
                          <div className="w-20 shrink-0 font-medium text-gray-100">{a.authority}</div>
                          <div className="flex-1 bg-[var(--bg-subtle)] rounded h-6 relative overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#0D1F3C] to-[#1f3a6e]"
                              style={{ width: `${pct}%` }}
                            />
                            <div className="absolute inset-0 flex items-center px-2 text-white text-[11px] font-medium">
                              {a.count} tender{a.count === 1 ? "" : "s"} · {fmtMW(a.mw)}
                              {a.applying > 0 && <span className="ml-2 px-1.5 rounded bg-amber-500/30">{a.applying} applying</span>}
                              {a.won > 0 && <span className="ml-2 px-1.5 rounded bg-emerald-500/30">{a.won} won</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>

            {/* Row 2: Bid funnel + Top winners */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Bid funnel"
                subtitle="Discovered → Reviewed → Applying → Submitted → Won. Where do tenders drop off?"
              >
                <div className="space-y-2">
                  {funnel.map((f, i) => {
                    const pct = (f.count / maxFunnel) * 100;
                    const prev = i > 0 ? funnel[i - 1].count : null;
                    const dropPct = prev && prev > 0 ? ((prev - f.count) / prev) * 100 : null;
                    return (
                      <div key={f.stage} className="flex items-center gap-3">
                        <div className="w-24 shrink-0">
                          <div className="text-xs font-semibold text-gray-100">{f.stage}</div>
                          <div className="text-[10px] text-gray-500">{f.hint}</div>
                        </div>
                        <div className="flex-1 bg-[var(--bg-subtle)] rounded-lg h-9 relative overflow-hidden">
                          <div
                            className={`h-full ${
                              i === 0 ? "bg-blue-500"
                              : i === 1 ? "bg-indigo-500"
                              : i === 2 ? "bg-amber-500"
                              : i === 3 ? "bg-orange-500"
                              : "bg-emerald-500"
                            }`}
                            style={{ width: `${Math.max(pct, 5)}%` }}
                          />
                          <div className="absolute inset-0 flex items-center px-3 text-white font-semibold text-sm">
                            {f.count}
                          </div>
                        </div>
                        <div className="w-16 text-right text-xs text-gray-500">
                          {dropPct != null && dropPct > 0 ? `−${dropPct.toFixed(0)}%` : i === 0 ? "" : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-3">
                  Submitted/Won require &quot;Ingro&quot; in the bid record. As your team logs more bids, these numbers will grow.
                </p>
              </Panel>

              <Panel
                title="Top winners (market)"
                subtitle="Companies winning the most BESS capacity across tracked tenders."
              >
                {topWinners.length === 0 ? <Empty hint="No award data captured yet." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="py-2 pr-3">Company</th>
                          <th className="py-2 pr-3 text-right">Wins</th>
                          <th className="py-2 pr-3 text-right">Losses</th>
                          <th className="py-2 pr-3 text-right">Capacity Won</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {topWinners.map((c) => (
                          <tr
                            key={c.id}
                            onClick={() => router.push(`/company/${encodeURIComponent(c.id)}`)}
                            className="hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors"
                          >
                            <td className="py-2 pr-3 text-gray-100 font-medium">{c.name}</td>
                            <td className="py-2 pr-3 text-right text-emerald-600 font-semibold">{c.bidsWon}</td>
                            <td className="py-2 pr-3 text-right text-gray-500">{c.bidsLost}</td>
                            <td className="py-2 pr-3 text-right">{fmtMWh(c.totalCapacityMWh)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            {/* Row 3: Cash detail + Geography */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Cash exposure breakdown"
                subtitle="Top tenders by EMD locked. Plan release dates."
              >
                {cashDetail.length === 0 ? (
                  <Empty hint="No active applying tenders with EMD data." />
                ) : (
                  <div className="space-y-2">
                    {cashDetail.map((t) => {
                      const dl = tsDate(t.bidDeadline);
                      const days = liveDaysLeft(t);
                      return (
                        <div
                          key={t.nitNumber}
                          onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}?from=/analytics`)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-100 truncate">
                              {t.authority || "?"} {t.powerMW || "?"}MW{t.energyMWh ? `/${t.energyMWh}MWh` : ""}
                            </div>
                            <div className="text-xs text-gray-500 truncate">{t.title}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-amber-600">{fmtCr(t.emdAmount)}</div>
                            <div className="text-[11px] text-gray-500">
                              {dl ? `releases in ${days != null && days >= 0 ? days + "d" : "—"}` : "no deadline"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel
                title="Geographic distribution"
                subtitle="Where the active pipeline sits. Concentration = risk."
              >
                {stateStats.length === 0 ? <Empty /> : (
                  <div className="space-y-1.5">
                    {stateStats.map((s) => {
                      const pct = (s.mw / maxStateMW) * 100;
                      return (
                        <div key={s.state} className="flex items-center gap-2 text-xs">
                          <div className="w-32 shrink-0 truncate font-medium text-gray-100" title={s.state}>{s.state}</div>
                          <div className="flex-1 bg-[var(--bg-subtle)] rounded h-6 relative overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-700"
                              style={{ width: `${pct}%` }}
                            />
                            <div className="absolute inset-0 flex items-center px-2 text-white text-[11px] font-medium">
                              {fmtMW(s.mw)} · {s.count} tender{s.count === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label, value, hint, accent = "text-gray-100", onClick,
}: { label: string; value: string; hint?: string; accent?: string; onClick?: () => void }) {
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-[var(--bg-card)] border border-gray-800 rounded-xl p-5 text-left ${onClick ? "hover:border-gray-600 transition-colors cursor-pointer" : ""}`}
    >
      <div className="text-xs font-medium text-gray-400 mb-2">{label}</div>
      <div className={`text-3xl font-bold ${accent}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-2">{hint}</div>}
    </Wrapper>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] border border-gray-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5 mb-3">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Empty({ hint }: { hint?: string }) {
  return (
    <div className="text-xs text-gray-500 py-8 text-center">
      {hint || "Nothing to show in the current time range."}
    </div>
  );
}

// Inline SVG line chart for tariff trend. Renders one line per VGF band.
function TariffChart({ data }: { data: Array<{ quarter: string; VGF1: number | null; VGF2: number | null; "No-VGF": number | null; count: number }> }) {
  const W = 560;
  const H = 200;
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 32;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const all = data.flatMap((d) => [d.VGF1, d.VGF2, d["No-VGF"]]).filter((x): x is number => x != null);
  if (all.length === 0) return <Empty />;
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const yPad = (yMax - yMin) * 0.1 || 100000;
  const y0 = Math.max(0, yMin - yPad);
  const y1 = yMax + yPad;

  const x = (i: number) => PAD_L + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD_T + innerH - ((v - y0) / (y1 - y0)) * innerH;

  const series: Array<{ key: "VGF1" | "VGF2" | "No-VGF"; color: string; label: string }> = [
    { key: "VGF2", color: "#10b981", label: "VGF2" },
    { key: "VGF1", color: "#f59e0b", label: "VGF1" },
    { key: "No-VGF", color: "#94a3b8", label: "No-VGF" },
  ];

  const linePath = (key: "VGF1" | "VGF2" | "No-VGF"): string => {
    const pts: string[] = [];
    let started = false;
    data.forEach((d, i) => {
      const v = d[key];
      if (v == null) return;
      pts.push(`${started ? "L" : "M"} ${x(i)} ${y(v)}`);
      started = true;
    });
    return pts.join(" ");
  };

  // Y-axis ticks
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => y0 + ((y1 - y0) * i) / ticks);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-xs">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: s.color }} />
            <span className="text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Y-grid */}
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3,3" />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.5}>
              ₹{(v / 100000).toFixed(1)}L
            </text>
          </g>
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => (
          <text key={d.quarter} x={x(i)} y={H - 14} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
            {d.quarter}
          </text>
        ))}
        {/* Lines */}
        {series.map((s) => (
          <path key={s.key} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={2} />
        ))}
        {/* Points */}
        {series.map((s) =>
          data.map((d, i) => {
            const v = d[s.key];
            if (v == null) return null;
            return <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(v)} r={3} fill={s.color} />;
          })
        )}
      </svg>
    </div>
  );
}

export default function AnalyticsPage() {
  return <AuthGuard><AnalyticsContent /></AuthGuard>;
}
