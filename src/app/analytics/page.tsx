"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getTenders, getBids, getCompanies,
  type Tender, type Bid, type Company,
} from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

type TimeRange = "1y" | "2y" | "all";
type DurationBucket = "2hr" | "3hr" | "4hr+";
type VGFBand = "No-VGF" | "VGF1" | "VGF2";

const DURATIONS: DurationBucket[] = ["2hr", "3hr", "4hr+"];
const BANDS: VGFBand[] = ["No-VGF", "VGF1", "VGF2"];

function fmtCr(rs: number | null | undefined): string {
  if (rs == null || isNaN(rs) || rs === 0) return "—";
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
  return `${Math.round(mw).toLocaleString("en-IN")} MW`;
}

function fmtMWh(mwh: number | null | undefined): string {
  if (mwh == null) return "—";
  if (mwh >= 1000) return `${(mwh / 1000).toFixed(1)} GWh`;
  return `${Math.round(mwh).toLocaleString("en-IN")} MWh`;
}

function bucketDuration(h: number | null | undefined): DurationBucket | null {
  if (h == null) return null;
  if (h <= 2.5) return "2hr";
  if (h <= 3.5) return "3hr";
  return "4hr+";
}

function quarterKey(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${String(d.getFullYear()).slice(2)}Q${q}`;
}

function tsDate(ts: { toDate?: () => Date } | null | undefined): Date | null {
  if (!ts) return null;
  try { return typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string); }
  catch { return null; }
}

function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  const d = tsDate(t.bidDeadline);
  return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null;
}

function isActive(t: Tender): boolean {
  if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return false;
  if ((t.sources || []).includes("excel-comparables-seed")) return false;
  const days = liveDaysLeft(t);
  return days == null || days >= 0;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function withinRange(d: Date | null, range: TimeRange): boolean {
  if (range === "all") return true;
  if (!d) return false;
  const cutoff = range === "1y" ? Date.now() - 365 * 86400000 : Date.now() - 730 * 86400000;
  return d.getTime() >= cutoff;
}

function AnalyticsContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>("all");
  const [selectedCell, setSelectedCell] = useState<{ dur: DurationBucket; band: VGFBand } | null>(null);

  useEffect(() => {
    Promise.all([getTenders(), getBids(), getCompanies()])
      .then(([t, b, c]) => { setTenders(t); setBids(b); setCompanies(c); })
      .finally(() => setLoading(false));
  }, []);

  // Awarded tenders = the corpus we mine for market intelligence.
  // Includes BENCH-* historical seeds + any tender result-tracker has stamped.
  const awarded = useMemo(() => {
    return tenders.filter((t) => {
      if (!t.tariffRsPerMwPerMonth) return false;
      const ad = tsDate(t.awardDate) || tsDate(t.firstSeenAt);
      return withinRange(ad, range);
    });
  }, [tenders, range]);

  const activeAll = useMemo(() => tenders.filter(isActive), [tenders]);

  // ── Pricing grid: median tariff per (duration × VGF band) ──
  const grid = useMemo(() => {
    const cells: Record<string, { tariffs: number[]; tenders: Tender[] }> = {};
    for (const d of DURATIONS) for (const b of BANDS) cells[`${d}|${b}`] = { tariffs: [], tenders: [] };
    for (const t of awarded) {
      const dur = bucketDuration(t.durationHours);
      const band = t.tariffBand;
      if (!dur || !band) continue;
      const key = `${dur}|${band}`;
      if (!cells[key]) continue;
      cells[key].tariffs.push(t.tariffRsPerMwPerMonth!);
      cells[key].tenders.push(t);
    }
    return cells;
  }, [awarded]);

  const overallTariffRange = useMemo(() => {
    const all = awarded.map((t) => t.tariffRsPerMwPerMonth!).filter(Boolean);
    return { min: Math.min(...all, Infinity), max: Math.max(...all, -Infinity) };
  }, [awarded]);

  const selectedCellTenders = useMemo(() => {
    if (!selectedCell) return [];
    const key = `${selectedCell.dur}|${selectedCell.band}`;
    return (grid[key]?.tenders || []).slice().sort((a, b) => (a.tariffRsPerMwPerMonth || 0) - (b.tariffRsPerMwPerMonth || 0));
  }, [grid, selectedCell]);

  // ── Tariff trend over time ──
  const tariffTrend = useMemo(() => {
    const buckets = new Map<string, { VGF1: number[]; VGF2: number[]; "No-VGF": number[]; quarter: string; ts: number }>();
    for (const t of awarded) {
      const ad = tsDate(t.awardDate) || tsDate(t.firstSeenAt);
      if (!ad) continue;
      const q = quarterKey(ad);
      if (!buckets.has(q)) buckets.set(q, { VGF1: [], VGF2: [], "No-VGF": [], quarter: q, ts: ad.getTime() });
      const b = buckets.get(q)!;
      const band = t.tariffBand;
      if (band === "VGF1" || band === "VGF2" || band === "No-VGF") b[band].push(t.tariffRsPerMwPerMonth!);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.ts - b.ts)
      .map((b) => ({
        quarter: b.quarter,
        VGF1: median(b.VGF1),
        VGF2: median(b.VGF2),
        "No-VGF": median(b["No-VGF"]),
        count: b.VGF1.length + b.VGF2.length + b["No-VGF"].length,
      }));
  }, [awarded]);

  // ── Top competitors: companies that have actually won, with their avg tariff and footprint ──
  const competitors = useMemo(() => {
    const wins = new Map<string, { name: string; wins: number; totalMWh: number; tariffs: number[]; states: Set<string> }>();
    for (const b of bids) {
      if (b.result !== "won") continue;
      const id = b.companyId;
      if (!id) continue;
      if (!wins.has(id)) wins.set(id, { name: b.companyName || id, wins: 0, totalMWh: 0, tariffs: [], states: new Set() });
      const c = wins.get(id)!;
      c.wins++;
      c.totalMWh += b.capacityMWh || 0;
      if (b.priceStandalone && b.priceStandalone > 0) c.tariffs.push(b.priceStandalone);
      if (b.state) c.states.add(b.state);
    }
    return Array.from(wins.values())
      .map((c) => ({
        name: c.name,
        wins: c.wins,
        totalMWh: c.totalMWh,
        avgTariff: c.tariffs.length > 0 ? c.tariffs.reduce((s, x) => s + x, 0) / c.tariffs.length : null,
        stateCount: c.states.size,
        states: Array.from(c.states).slice(0, 3).join(", "),
      }))
      .sort((a, b) => b.totalMWh - a.totalMWh || b.wins - a.wins)
      .slice(0, 10);
  }, [bids]);

  // ── Bidder competition: avg # bidders by tender size band ──
  const competition = useMemo(() => {
    // For each closed tender, count how many bid records exist
    const byTender = new Map<string, number>();
    for (const b of bids) {
      if (!b.tenderNit) continue;
      byTender.set(b.tenderNit, (byTender.get(b.tenderNit) || 0) + 1);
    }
    const buckets = {
      "<100 MW": [] as number[],
      "100-300 MW": [] as number[],
      "300-1000 MW": [] as number[],
      "1+ GW": [] as number[],
    };
    for (const t of tenders) {
      const n = byTender.get(t.nitNumber);
      if (!n || n === 0) continue;
      const mw = t.powerMW;
      if (mw == null) continue;
      const bucket = mw < 100 ? "<100 MW" : mw < 300 ? "100-300 MW" : mw < 1000 ? "300-1000 MW" : "1+ GW";
      buckets[bucket].push(n);
    }
    return Object.entries(buckets).map(([range, counts]) => ({
      range,
      avg: counts.length > 0 ? counts.reduce((s, x) => s + x, 0) / counts.length : 0,
      tenderCount: counts.length,
      max: counts.length > 0 ? Math.max(...counts) : 0,
    }));
  }, [tenders, bids]);

  // ── Authority performance ──
  const authorityPerf = useMemo(() => {
    const map = new Map<string, { count: number; mw: number; mwh: number; awarded: number; active: number }>();
    for (const t of tenders) {
      if ((t.sources || []).includes("excel-comparables-seed")) continue;
      const auth = t.authority;
      if (!auth) continue;
      const fs = tsDate(t.firstSeenAt);
      if (!withinRange(fs, range)) continue;
      if (!map.has(auth)) map.set(auth, { count: 0, mw: 0, mwh: 0, awarded: 0, active: 0 });
      const s = map.get(auth)!;
      s.count++;
      s.mw += t.powerMW || 0;
      s.mwh += t.energyMWh || 0;
      if (t.awardedTo) s.awarded++;
      if (isActive(t)) s.active++;
    }
    return Array.from(map.entries())
      .map(([auth, s]) => ({ authority: auth, ...s }))
      .sort((a, b) => b.mwh - a.mwh)
      .slice(0, 10);
  }, [tenders, range]);

  // ── Active pipeline action items ──
  const actions = useMemo(() => {
    const closingThisWeek = activeAll.filter((t) => {
      const d = liveDaysLeft(t);
      return d != null && d >= 0 && d <= 7;
    });
    const noChecklist = closingThisWeek.filter((t) => !t.assignedTo);
    const stuck = activeAll.filter((t) => t.assignedTo && !Object.values(t.flags || {}).some((f) => f === "Applying"));
    const orphan = activeAll.filter((t) => !t.assignedTo && !Object.values(t.flags || {}).some((f) => !!f && f !== "—"));
    return {
      closingThisWeek: closingThisWeek.length,
      hot: noChecklist.slice(0, 5),
      stuck: stuck.slice(0, 5),
      orphan: orphan.slice(0, 5),
    };
  }, [activeAll]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const pipelineMW = activeAll.reduce((s, t) => s + (t.powerMW || 0), 0);
    const pipelineMWh = activeAll.reduce((s, t) => s + (t.energyMWh || 0), 0);
    const pipelineValue = activeAll.reduce((s, t) => s + (t.totalCost || 0), 0);
    const cashLocked = activeAll
      .filter((t) => Object.values(t.flags || {}).some((f) => f === "Applying"))
      .reduce((s, t) => s + (t.emdAmount || 0), 0);
    const benchmarkMedian = grid["2hr|VGF2"]?.tariffs.length
      ? median(grid["2hr|VGF2"].tariffs)
      : null;
    return { pipelineMW, pipelineMWh, pipelineValue, cashLocked, benchmarkMedian };
  }, [activeAll, grid]);

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />

      <div className="sidebar-content sticky top-0 z-40 bg-[var(--bg-card)] border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-100">Analytics</h1>
          <span className="text-xs text-gray-400 hidden md:inline">
            What the {awarded.length} awarded tenders + {bids.filter((b) => b.result === "won").length} bid records tell us
          </span>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {(["1y", "2y", "all"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  range === r
                    ? "bg-[#0D1F3C] text-white"
                    : "text-gray-500 hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {r === "1y" ? "12 months" : r === "2y" ? "24 months" : "All time"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-content px-6 py-6 max-w-7xl space-y-5">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-800/50 rounded-xl animate-pulse" />)}
            </div>
            <div className="h-80 bg-gray-800/50 rounded-xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* KPI strip — strategic, not just counts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi
                label="Active pipeline"
                value={fmtMW(kpis.pipelineMW)}
                hint={`${activeAll.length} tenders · ${fmtMWh(kpis.pipelineMWh)}`}
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
                label="Benchmark — 2hr VGF2"
                value={kpis.benchmarkMedian ? fmtTariff(kpis.benchmarkMedian) : "—"}
                hint={`Current floor for standard 2hr standalone bids`}
                accent="text-violet-500"
              />
              <Kpi
                label="EMD locked"
                value={fmtCr(kpis.cashLocked)}
                hint={`${actions.closingThisWeek} bid${actions.closingThisWeek === 1 ? "" : "s"} due this week`}
                accent={kpis.cashLocked > 0 ? "text-amber-500" : "text-gray-400"}
              />
            </div>

            {/* HERO: Pricing grid */}
            <Panel
              title="Pricing intelligence"
              subtitle="What past awards tell us. Median ₹/MW/Month for each duration × VGF band combo. Click a cell to see the underlying tenders."
            >
              <PricingGrid grid={grid} onCellClick={setSelectedCell} selected={selectedCell} />
              {selectedCell && (
                <div className="mt-4 p-4 bg-[var(--bg-subtle)] rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-gray-100">
                      {selectedCell.dur} · {selectedCell.band} — {selectedCellTenders.length} award{selectedCellTenders.length === 1 ? "" : "s"}
                    </div>
                    <button onClick={() => setSelectedCell(null)} className="text-xs text-gray-400 hover:text-gray-100">Close</button>
                  </div>
                  <div className="space-y-1.5">
                    {selectedCellTenders.map((t) => (
                      <div
                        key={t.nitNumber}
                        onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}?from=/analytics`)}
                        className="flex items-center justify-between text-xs p-2 rounded hover:bg-[var(--bg-card)] cursor-pointer"
                      >
                        <div className="flex-1 truncate text-gray-100">
                          <span className="font-medium">{t.authority}</span>
                          {" · "}
                          <span className="text-gray-500">{t.powerMW}MW/{t.energyMWh}MWh</span>
                          {" · "}
                          <span className="text-gray-500">{t.state}</span>
                          {t.awardedTo && <span className="text-emerald-600 ml-2">→ {t.awardedTo}</span>}
                        </div>
                        <div className="text-sm font-semibold text-gray-100">{fmtTariff(t.tariffRsPerMwPerMonth)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-3">
                Reading the grid: greener = cheaper benchmark, redder = pricier. Empty cells need more award data — fill in via the &quot;Awarded To&quot; + tariff fields on the tender detail page.
              </p>
            </Panel>

            {/* Row: Tariff trajectory + Active action items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Tariff trajectory"
                subtitle="Quarterly median, by VGF band. The line shows whether prices are still falling."
              >
                {tariffTrend.length === 0 ? (
                  <Empty hint="Need awarded tenders with tariff + award date." />
                ) : (
                  <TariffChart data={tariffTrend} />
                )}
                {tariffTrend.length >= 2 && (() => {
                  const recent = tariffTrend.filter((q) => q.VGF2 != null).slice(-4);
                  if (recent.length < 2) return null;
                  const first = recent[0].VGF2!;
                  const last = recent[recent.length - 1].VGF2!;
                  const pct = ((last - first) / first) * 100;
                  return (
                    <div className="mt-3 text-xs">
                      <span className="text-gray-500">VGF2 trend over the last {recent.length} quarter{recent.length === 1 ? "" : "s"}: </span>
                      <span className={pct < 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })()}
              </Panel>

              <Panel
                title="Action items"
                subtitle="What the team should look at first thing tomorrow."
              >
                <ActionItems
                  closingThisWeek={actions.closingThisWeek}
                  hot={actions.hot}
                  stuck={actions.stuck}
                  orphan={actions.orphan}
                  onTender={(nit) => router.push(`/tender/${encodeURIComponent(nit)}?from=/analytics`)}
                />
              </Panel>
            </div>

            {/* Row: Competitors + Competition density */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Top winners"
                subtitle={`${competitors.length} companies who've actually won BESS capacity. Sorted by total MWh.`}
              >
                {competitors.length === 0 ? <Empty /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="py-2 pr-3">Company</th>
                          <th className="py-2 pr-3 text-right">Wins</th>
                          <th className="py-2 pr-3 text-right">Total MWh</th>
                          <th className="py-2 pr-3 text-right">Avg ₹L/MW</th>
                          <th className="py-2 pr-3">States</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {competitors.map((c, i) => (
                          <tr key={i} className="hover:bg-[var(--bg-subtle)]">
                            <td className="py-2 pr-3 text-gray-100 font-medium">{c.name}</td>
                            <td className="py-2 pr-3 text-right text-emerald-600 font-semibold">{c.wins}</td>
                            <td className="py-2 pr-3 text-right">{fmtMWh(c.totalMWh)}</td>
                            <td className="py-2 pr-3 text-right">{c.avgTariff ? c.avgTariff.toFixed(2) : "—"}</td>
                            <td className="py-2 pr-3 text-gray-500 max-w-[140px] truncate" title={c.states}>
                              {c.stateCount > 0 ? `${c.stateCount}: ${c.states}${c.stateCount > 3 ? "…" : ""}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel
                title="Competition density"
                subtitle="How many bidders typically show up at each tender size? Smaller tenders = lighter competition."
              >
                {competition.every((c) => c.tenderCount === 0) ? <Empty hint="Need awarded tenders with bid records." /> : (
                  <div className="space-y-3">
                    {competition.map((c) => {
                      const maxBidders = 25;
                      const pct = Math.min(100, (c.avg / maxBidders) * 100);
                      return (
                        <div key={c.range} className="text-xs">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="font-medium text-gray-100">{c.range}</span>
                            <span className="text-gray-500">
                              <span className="font-semibold text-gray-100">{c.avg.toFixed(1)}</span> avg bidders
                              {c.tenderCount > 0 && <span> · across {c.tenderCount} tender{c.tenderCount === 1 ? "" : "s"}</span>}
                              {c.max > 0 && <span> · max {c.max}</span>}
                            </span>
                          </div>
                          <div className="bg-[var(--bg-subtle)] rounded h-3 relative overflow-hidden">
                            <div
                              className={`h-full ${
                                c.avg < 5 ? "bg-emerald-500"
                                : c.avg < 10 ? "bg-amber-500"
                                : "bg-red-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-gray-400 mt-2">
                      Green = light competition (under 5 bidders typical), amber = moderate, red = crowded. Use this to pick where to focus.
                    </p>
                  </div>
                )}
              </Panel>
            </div>

            {/* Authority performance */}
            <Panel
              title="Authority focus"
              subtitle="Which DISCOMs run the most BESS capacity. Use this to plan your relationship priorities."
            >
              {authorityPerf.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-2 pr-3">Authority</th>
                        <th className="py-2 pr-3 text-right">Tenders</th>
                        <th className="py-2 pr-3 text-right">Total MW</th>
                        <th className="py-2 pr-3 text-right">Total MWh</th>
                        <th className="py-2 pr-3 text-right">Awarded</th>
                        <th className="py-2 pr-3 text-right">Active now</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {authorityPerf.map((a) => (
                        <tr key={a.authority} className="hover:bg-[var(--bg-subtle)]">
                          <td className="py-2 pr-3 text-gray-100 font-medium">{a.authority}</td>
                          <td className="py-2 pr-3 text-right">{a.count}</td>
                          <td className="py-2 pr-3 text-right">{fmtMW(a.mw)}</td>
                          <td className="py-2 pr-3 text-right font-semibold">{fmtMWh(a.mwh)}</td>
                          <td className="py-2 pr-3 text-right text-emerald-600">{a.awarded > 0 ? a.awarded : "—"}</td>
                          <td className="py-2 pr-3 text-right text-blue-600 font-semibold">{a.active > 0 ? a.active : "—"}</td>
                          <td className="py-2 pr-3 text-right">
                            {a.active > 0 && (
                              <button
                                onClick={() => router.push(`/dashboard?authority=${encodeURIComponent(a.authority)}`)}
                                className="text-[#0D1F3C] hover:underline text-xs"
                              >
                                Filter →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
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
      className={`bg-[var(--bg-card)] border border-gray-800 rounded-xl p-4 text-left ${onClick ? "hover:border-gray-600 transition-colors cursor-pointer" : ""}`}
    >
      <div className="text-xs font-medium text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1.5">{hint}</div>}
    </Wrapper>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] border border-gray-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Empty({ hint }: { hint?: string }) {
  return (
    <div className="text-xs text-gray-500 py-8 text-center">
      {hint || "Not enough data yet."}
    </div>
  );
}

function PricingGrid({
  grid, onCellClick, selected,
}: {
  grid: Record<string, { tariffs: number[]; tenders: Tender[] }>;
  onCellClick: (cell: { dur: DurationBucket; band: VGFBand } | null) => void;
  selected: { dur: DurationBucket; band: VGFBand } | null;
}) {
  // Compute global min/max for color scale
  const allMedians: number[] = [];
  for (const dur of DURATIONS) for (const band of BANDS) {
    const m = median(grid[`${dur}|${band}`]?.tariffs || []);
    if (m != null) allMedians.push(m);
  }
  const minTariff = Math.min(...allMedians, Infinity);
  const maxTariff = Math.max(...allMedians, -Infinity);

  const cellBg = (m: number | null) => {
    if (m == null) return "bg-[var(--bg-subtle)]";
    if (allMedians.length < 2 || maxTariff === minTariff) return "bg-emerald-100";
    const t = (m - minTariff) / (maxTariff - minTariff); // 0 = cheapest = green, 1 = priciest = red
    if (t < 0.33) return "bg-emerald-100";
    if (t < 0.66) return "bg-amber-100";
    return "bg-red-100";
  };
  const cellText = (m: number | null) => {
    if (m == null) return "text-gray-400";
    return "text-gray-900";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left text-[10px] uppercase tracking-wider text-gray-500 pb-2 font-semibold w-20">Duration</th>
            {BANDS.map((band) => (
              <th key={band} className="text-center text-[10px] uppercase tracking-wider text-gray-500 pb-2 font-semibold">
                {band}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DURATIONS.map((dur) => (
            <tr key={dur}>
              <td className="text-sm font-semibold text-gray-100 pr-2 py-1">{dur}</td>
              {BANDS.map((band) => {
                const cell = grid[`${dur}|${band}`];
                const m = median(cell?.tariffs || []);
                const count = cell?.tariffs.length || 0;
                const isSelected = selected?.dur === dur && selected?.band === band;
                return (
                  <td key={band} className="p-1">
                    <button
                      disabled={count === 0}
                      onClick={() => onCellClick(isSelected ? null : { dur, band })}
                      className={`w-full p-3 rounded-lg ${cellBg(m)} ${cellText(m)} text-center transition-all ${
                        count === 0 ? "cursor-not-allowed opacity-60" : "hover:ring-2 hover:ring-[#0D1F3C] cursor-pointer"
                      } ${isSelected ? "ring-2 ring-[#0D1F3C]" : ""}`}
                    >
                      <div className="text-xl font-bold leading-tight">
                        {m != null ? `₹${(m / 100000).toFixed(2)}L` : "—"}
                      </div>
                      <div className="text-[10px] mt-1 opacity-75">
                        {count > 0 ? `${count} award${count === 1 ? "" : "s"}` : "no data"}
                      </div>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionItems({
  closingThisWeek, hot, stuck, orphan, onTender,
}: {
  closingThisWeek: number;
  hot: Tender[];
  stuck: Tender[];
  orphan: Tender[];
  onTender: (nit: string) => void;
}) {
  const sections = [
    { label: "Closing in 7d, no assignee", color: "text-red-600", items: hot },
    { label: "Assigned but not Applying", color: "text-amber-600", items: stuck },
    { label: "Unflagged + unassigned", color: "text-gray-500", items: orphan },
  ];
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <div key={s.label}>
          <div className="flex items-baseline justify-between mb-1.5">
            <h3 className={`text-xs font-semibold ${s.color}`}>{s.label}</h3>
            <span className="text-[11px] text-gray-400">{s.items.length}</span>
          </div>
          {s.items.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-1.5">All clear</div>
          ) : (
            <div className="space-y-1">
              {s.items.map((t) => (
                <button
                  key={t.nitNumber}
                  onClick={() => onTender(t.nitNumber)}
                  className="w-full text-left flex items-center justify-between p-1.5 rounded hover:bg-[var(--bg-subtle)] transition-colors text-xs"
                >
                  <span className="text-gray-100 truncate">
                    {t.authority || "?"} {t.powerMW || "?"}MW{t.energyMWh ? `/${t.energyMWh}MWh` : ""}
                    <span className="text-gray-500 ml-1.5 truncate">— {(t.title || t.nitNumber).slice(0, 50)}</span>
                  </span>
                  <span className="text-gray-400 shrink-0 ml-2">
                    {liveDaysLeft(t) != null ? `${liveDaysLeft(t)}d` : "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {closingThisWeek === 0 && hot.length === 0 && stuck.length === 0 && orphan.length === 0 && (
        <Empty hint="Pipeline is clean. Nothing demands action right now." />
      )}
    </div>
  );
}

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
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3,3" />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.5}>
              ₹{(v / 100000).toFixed(1)}L
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={d.quarter} x={x(i)} y={H - 14} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
            {d.quarter}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.key} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={2} />
        ))}
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
