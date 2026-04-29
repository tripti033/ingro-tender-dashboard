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
type Category = "All" | "Standalone" | "FDRE" | "S+S" | "PSP" | "Hybrid";

const DURATIONS: DurationBucket[] = ["2hr", "3hr", "4hr+"];
const BANDS: VGFBand[] = ["No-VGF", "VGF1", "VGF2"];
const CATEGORIES: Category[] = ["All", "Standalone", "FDRE", "S+S", "PSP", "Hybrid"];

const BAND_COLOR: Record<VGFBand, string> = {
  "VGF2": "#10b981",
  "VGF1": "#f59e0b",
  "No-VGF": "#94a3b8",
};

// Category palette — used in donut + horizontal bars. Picked so each category
// stays distinct from the VGF band colours used elsewhere on the page.
const CATEGORY_COLOR: Record<string, string> = {
  "Standalone": "#3b82f6",
  "FDRE": "#8b5cf6",
  "S+S": "#ec4899",
  "PSP": "#14b8a6",
  "Pump Storage Plant": "#14b8a6",
  "Hybrid": "#f97316",
  "Other": "#6b7280",
};

function normCategory(c: string | null | undefined): string {
  if (!c) return "Other";
  if (c === "Pump Storage Plant") return "PSP";
  return c;
}

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
  const [, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>("all");
  const [category, setCategory] = useState<Category>("All");
  const [selectedCell, setSelectedCell] = useState<{ dur: DurationBucket; band: VGFBand } | null>(null);

  const matchesCategory = (t: Tender) => {
    if (category === "All") return true;
    if (category === "PSP") return t.category === "PSP" || t.category === "Pump Storage Plant";
    return t.category === category;
  };

  const matchesCategoryBid = (b: Bid) => {
    if (category === "All") return true;
    if (category === "PSP") return b.category === "PSP" || b.category === "Pump Storage Plant";
    return b.category === category;
  };

  useEffect(() => {
    Promise.all([getTenders(), getBids(), getCompanies()])
      .then(([t, b, c]) => { setTenders(t); setBids(b); setCompanies(c); })
      .finally(() => setLoading(false));
  }, []);

  const awarded = useMemo(() => {
    return tenders.filter((t) => {
      if (!t.tariffRsPerMwPerMonth) return false;
      if (!matchesCategory(t)) return false;
      const ad = tsDate(t.awardDate) || tsDate(t.firstSeenAt);
      return withinRange(ad, range);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenders, range, category]);

  const activeAll = useMemo(
    () => tenders.filter((t) => isActive(t) && matchesCategory(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenders, category]
  );

  // Always-unfiltered view of all active tenders — used by the Category mix
  // panel so its donut still shows every category even when the user has
  // filtered the rest of the page down.
  const activeAllUnfiltered = useMemo(() => tenders.filter(isActive), [tenders]);

  // ── Pricing grid ──
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

  const selectedCellTenders = useMemo(() => {
    if (!selectedCell) return [];
    const key = `${selectedCell.dur}|${selectedCell.band}`;
    return (grid[key]?.tenders || []).slice().sort((a, b) => (a.tariffRsPerMwPerMonth || 0) - (b.tariffRsPerMwPerMonth || 0));
  }, [grid, selectedCell]);

  // ── Tariff trend ──
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

  // ── Scatter: capacity vs tariff ──
  const scatterPoints = useMemo(() => {
    return awarded
      .filter((t) => t.energyMWh && t.tariffRsPerMwPerMonth && t.tariffBand)
      .map((t) => ({
        mwh: t.energyMWh!,
        tariff: t.tariffRsPerMwPerMonth!,
        band: t.tariffBand as VGFBand,
        label: `${t.authority || "?"} ${t.powerMW}MW/${t.energyMWh}MWh`,
        nit: t.nitNumber,
      }));
  }, [awarded]);

  // ── Quarterly MW awarded (stacked bar) ──
  const quarterlyMW = useMemo(() => {
    const buckets = new Map<string, { "VGF2": number; "VGF1": number; "No-VGF": number; quarter: string; ts: number }>();
    for (const t of awarded) {
      const ad = tsDate(t.awardDate) || tsDate(t.firstSeenAt);
      if (!ad || !t.powerMW) continue;
      const q = quarterKey(ad);
      if (!buckets.has(q)) buckets.set(q, { VGF2: 0, VGF1: 0, "No-VGF": 0, quarter: q, ts: ad.getTime() });
      const b = buckets.get(q)!;
      const band = t.tariffBand;
      if (band === "VGF1" || band === "VGF2" || band === "No-VGF") b[band] += t.powerMW;
    }
    return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
  }, [awarded]);

  // ── Top winners (horizontal bars) ──
  const topWinners = useMemo(() => {
    const wins = new Map<string, { name: string; wins: number; totalMWh: number; tariffs: number[]; states: Set<string> }>();
    for (const b of bids) {
      if (b.result !== "won") continue;
      if (!matchesCategoryBid(b)) continue;
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
      }))
      .sort((a, b) => b.totalMWh - a.totalMWh || b.wins - a.wins)
      .slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bids, category]);

  // ── Competition density ──
  const competition = useMemo(() => {
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
      if (!matchesCategory(t)) continue;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenders, bids, category]);

  // ── Category mix (active pipeline) — always shows all categories,
  //    independent of the page-level category filter so the user can see the
  //    full breakdown when picking which slice to drill into.
  const categoryMixPipeline = useMemo(() => {
    const counts = new Map<string, { count: number; mw: number }>();
    let total = 0;
    for (const t of activeAllUnfiltered) {
      const cat = normCategory(t.category);
      if (!counts.has(cat)) counts.set(cat, { count: 0, mw: 0 });
      const c = counts.get(cat)!;
      c.count++;
      if (t.powerMW) {
        c.mw += t.powerMW;
        total += t.powerMW;
      }
    }
    return Array.from(counts.entries())
      .map(([cat, v]) => ({
        category: cat,
        count: v.count,
        mw: v.mw,
        pctMW: total > 0 ? (v.mw / total) * 100 : 0,
      }))
      .sort((a, b) => b.mw - a.mw);
  }, [activeAllUnfiltered]);

  const kpis = useMemo(() => {
    const pipelineMW = activeAll.reduce((s, t) => s + (t.powerMW || 0), 0);
    const pipelineMWh = activeAll.reduce((s, t) => s + (t.energyMWh || 0), 0);
    const pipelineValue = activeAll.reduce((s, t) => s + (t.totalCost || 0), 0);
    const cashLocked = activeAll
      .filter((t) => Object.values(t.flags || {}).some((f) => f === "Applying"))
      .reduce((s, t) => s + (t.emdAmount || 0), 0);
    const benchmarkMedian = median(grid["2hr|VGF2"]?.tariffs || []);
    const closingThisWeek = activeAll.filter((t) => {
      const d = liveDaysLeft(t);
      return d != null && d >= 0 && d <= 7;
    }).length;
    return { pipelineMW, pipelineMWh, pipelineValue, cashLocked, benchmarkMedian, closingThisWeek };
  }, [activeAll, grid]);

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />

      <div className="sidebar-content sticky top-0 z-40 bg-[var(--bg-card)] border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-bold text-gray-100">Analytics</h1>
          <span className="text-xs text-gray-400 hidden md:inline">
            {awarded.length} awarded · {topWinners.length > 0 ? `${topWinners.length} active winners` : "0 winners"}
            {category !== "All" ? ` · filtered to ${category}` : ""}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1 text-xs">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                  category === c
                    ? "bg-[#0D1F3C] text-white"
                    : "text-gray-500 hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {c}
              </button>
            ))}
            <span className="mx-2 text-gray-300">|</span>
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
            {/* KPI strip */}
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
                hint="Current floor for standard 2hr standalone bids"
                accent="text-violet-500"
              />
              <Kpi
                label="EMD locked"
                value={fmtCr(kpis.cashLocked)}
                hint={`${kpis.closingThisWeek} bid${kpis.closingThisWeek === 1 ? "" : "s"} due this week`}
                accent={kpis.cashLocked > 0 ? "text-amber-500" : "text-gray-400"}
              />
            </div>

            {/* HERO: Pricing grid */}
            <Panel
              title="Pricing intelligence"
              subtitle="Median ₹/MW/Month for each duration × VGF band combo. Click a cell to see the underlying tenders."
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
            </Panel>

            {/* Row 1: Tariff trajectory + Capacity-vs-Tariff scatter */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Tariff trajectory"
                subtitle="Quarterly median ₹/MW/Month, split by VGF band. Direction matters more than absolute value."
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
                      <span className="text-gray-500">VGF2 over last {recent.length} quarter{recent.length === 1 ? "" : "s"}: </span>
                      <span className={pct < 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })()}
              </Panel>

              <Panel
                title="Capacity vs Tariff"
                subtitle="Each dot is one award. X = MWh, Y = ₹/MW/Month. Color by VGF band. Bigger projects usually price lower."
              >
                {scatterPoints.length === 0 ? (
                  <Empty hint="Need awarded tenders with capacity + tariff." />
                ) : (
                  <ScatterChart points={scatterPoints} onClick={(nit) => router.push(`/tender/${encodeURIComponent(nit)}?from=/analytics`)} />
                )}
              </Panel>
            </div>

            {/* Row 2: Quarterly MW stacked bar + VGF band donut */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="MW awarded per quarter"
                subtitle="Stacked by VGF band. Shows market growth + how each tranche took over."
              >
                {quarterlyMW.length === 0 ? (
                  <Empty hint="Need awarded tenders with MW + award date." />
                ) : (
                  <StackedBarChart data={quarterlyMW} />
                )}
              </Panel>

              <Panel
                title="Pipeline by category"
                subtitle="Share of active MW by tender type. Click a slice in the header to filter the rest of the page."
              >
                {categoryMixPipeline.length === 0 ? (
                  <Empty hint="No active pipeline yet." />
                ) : (
                  <CategoryDonut
                    data={categoryMixPipeline}
                    selected={category === "All" ? null : category === "PSP" ? "PSP" : category}
                    onSelect={(cat) => {
                      const next = (cat === category || cat == null) ? "All" : (cat as Category);
                      setCategory(next);
                    }}
                  />
                )}
              </Panel>
            </div>

            {/* Row 3: Top winners horizontal bars + Competition density */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title="Top winners"
                subtitle="Companies ranked by total MWh won across tracked tenders."
              >
                {topWinners.length === 0 ? <Empty /> : (
                  <HorizontalBars
                    data={topWinners.map((c) => ({
                      label: c.name,
                      value: c.totalMWh,
                      meta: `${c.wins} win${c.wins === 1 ? "" : "s"}${c.avgTariff ? ` · avg ₹${c.avgTariff.toFixed(2)}L/MW` : ""}${c.stateCount > 0 ? ` · ${c.stateCount} state${c.stateCount === 1 ? "" : "s"}` : ""}`,
                      formatted: fmtMWh(c.totalMWh),
                    }))}
                  />
                )}
              </Panel>

              <Panel
                title="Competition density"
                subtitle="Avg # of bidders by tender size. Smaller sizes = lighter competition."
              >
                {competition.every((c) => c.tenderCount === 0) ? <Empty /> : (
                  <CompetitionBars data={competition} />
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
    const t = (m - minTariff) / (maxTariff - minTariff);
    if (t < 0.33) return "bg-emerald-100";
    if (t < 0.66) return "bg-amber-100";
    return "bg-red-100";
  };
  const cellText = (m: number | null) => m == null ? "text-gray-400" : "text-gray-900";

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left text-[10px] uppercase tracking-wider text-gray-500 pb-2 font-semibold w-20">Duration</th>
            {BANDS.map((band) => (
              <th key={band} className="text-center text-[10px] uppercase tracking-wider text-gray-500 pb-2 font-semibold">{band}</th>
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

  const series = BANDS.slice().reverse().map((band) => ({ key: band, color: BAND_COLOR[band], label: band }));

  const linePath = (key: VGFBand): string => {
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
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.5}>₹{(v / 100000).toFixed(1)}L</text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={d.quarter} x={x(i)} y={H - 14} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>{d.quarter}</text>
        ))}
        {series.map((s) => <path key={s.key} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={2} />)}
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

function ScatterChart({
  points, onClick,
}: {
  points: Array<{ mwh: number; tariff: number; band: VGFBand; label: string; nit: string }>;
  onClick: (nit: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const W = 560;
  const H = 240;
  const PAD_L = 44;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xVals = points.map((p) => p.mwh);
  const yVals = points.map((p) => p.tariff);
  const xMin = 0;
  const xMax = Math.max(...xVals) * 1.1;
  const yMin = Math.min(...yVals) * 0.85;
  const yMax = Math.max(...yVals) * 1.05;

  const x = (v: number) => PAD_L + ((v - xMin) / (xMax - xMin)) * innerW;
  const y = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const xTicks = 5;
  const yTicks = 4;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-xs">
        {BANDS.slice().reverse().map((b) => (
          <div key={b} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: BAND_COLOR[b] }} />
            <span className="text-gray-500">{b}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Y grid */}
        {Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks).map((v, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3,3" />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.5}>₹{(v / 100000).toFixed(1)}L</text>
          </g>
        ))}
        {/* X axis labels */}
        {Array.from({ length: xTicks + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / xTicks).map((v, i) => (
          <text key={`x${i}`} x={x(v)} y={H - 18} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)}
          </text>
        ))}
        <text x={PAD_L + innerW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>MWh capacity</text>
        {/* Points */}
        {points.map((p) => (
          <g key={p.nit}>
            <circle
              cx={x(p.mwh)}
              cy={y(p.tariff)}
              r={hover === p.nit ? 7 : 5}
              fill={BAND_COLOR[p.band]}
              fillOpacity={0.7}
              stroke={hover === p.nit ? "#0D1F3C" : "none"}
              strokeWidth={2}
              style={{ cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={() => setHover(p.nit)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onClick(p.nit)}
            />
          </g>
        ))}
      </svg>
      {hover && (() => {
        const p = points.find((x) => x.nit === hover);
        if (!p) return null;
        return (
          <div className="text-xs bg-[var(--bg-subtle)] rounded p-2 mt-2">
            <div className="font-semibold text-gray-100">{p.label}</div>
            <div className="text-gray-500">
              {fmtMWh(p.mwh)} · {fmtTariff(p.tariff)}/MW/Mo · <span style={{ color: BAND_COLOR[p.band] }}>{p.band}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function StackedBarChart({
  data,
}: {
  data: Array<{ quarter: string; VGF2: number; VGF1: number; "No-VGF": number; ts: number }>;
}) {
  const W = 560;
  const H = 240;
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const totals = data.map((d) => d.VGF2 + d.VGF1 + d["No-VGF"]);
  const yMax = Math.max(...totals) * 1.1;
  const barW = innerW / data.length * 0.7;
  const barGap = innerW / data.length * 0.3;
  const x = (i: number) => PAD_L + i * (barW + barGap) + barGap / 2;
  const y = (v: number) => PAD_T + innerH - (v / yMax) * innerH;
  const h = (v: number) => (v / yMax) * innerH;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (yMax * i) / yTicks);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-xs">
        {BANDS.slice().reverse().map((b) => (
          <div key={b} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: BAND_COLOR[b] }} />
            <span className="text-gray-500">{b}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3,3" />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.5}>
              {v >= 1000 ? `${(v / 1000).toFixed(1)}GW` : `${Math.round(v)}MW`}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          let yCursor = innerH + PAD_T;
          const segments: Array<{ band: VGFBand; mw: number; yTop: number; height: number }> = [];
          for (const band of BANDS) {
            const mw = d[band];
            if (mw <= 0) continue;
            const segH = h(mw);
            yCursor -= segH;
            segments.push({ band, mw, yTop: yCursor, height: segH });
          }
          return (
            <g key={d.quarter}>
              {segments.map((s) => (
                <rect
                  key={s.band}
                  x={x(i)}
                  y={s.yTop}
                  width={barW}
                  height={s.height}
                  fill={BAND_COLOR[s.band]}
                />
              ))}
              <text x={x(i) + barW / 2} y={H - 18} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                {d.quarter}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CategoryDonut({
  data, selected, onSelect,
}: {
  data: Array<{ category: string; mw: number; pctMW: number; count: number }>;
  selected: string | null;
  onSelect: (cat: string | null) => void;
}) {
  const total = data.reduce((s, d) => s + d.mw, 0);
  if (total === 0) return <Empty />;

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 90;
  const rInner = 55;

  let cursor = -Math.PI / 2;
  const arcs = data
    .filter((d) => d.mw > 0)
    .map((d) => {
      const angle = (d.mw / total) * 2 * Math.PI;
      const start = cursor;
      const end = cursor + angle;
      cursor = end;
      const x1 = cx + Math.cos(start) * rOuter;
      const y1 = cy + Math.sin(start) * rOuter;
      const x2 = cx + Math.cos(end) * rOuter;
      const y2 = cy + Math.sin(end) * rOuter;
      const x3 = cx + Math.cos(end) * rInner;
      const y3 = cy + Math.sin(end) * rInner;
      const x4 = cx + Math.cos(start) * rInner;
      const y4 = cy + Math.sin(start) * rInner;
      const largeArc = angle > Math.PI ? 1 : 0;
      const path = [
        `M ${x1} ${y1}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
        "Z",
      ].join(" ");
      return { ...d, path };
    });

  return (
    <div className="flex items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        {arcs.map((a) => {
          const isDim = selected != null && selected !== a.category;
          return (
            <path
              key={a.category}
              d={a.path}
              fill={CATEGORY_COLOR[a.category] || CATEGORY_COLOR.Other}
              opacity={isDim ? 0.25 : 1}
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
              onClick={() => onSelect(a.category)}
            />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>Total</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={14} fontWeight={700} fill="currentColor">{fmtMW(total)}</text>
      </svg>
      <div className="flex-1 space-y-2">
        {data.map((d) => {
          const isSelected = selected === d.category;
          return (
            <button
              key={d.category}
              onClick={() => onSelect(d.category)}
              className={`w-full text-left text-xs p-1.5 -mx-1.5 rounded transition-colors ${
                isSelected ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]"
              }`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="flex items-center gap-2 font-medium text-gray-100">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{ background: CATEGORY_COLOR[d.category] || CATEGORY_COLOR.Other }}
                  />
                  {d.category}
                </span>
                <span className="text-gray-500">{d.count} tender{d.count === 1 ? "" : "s"}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-gray-500">{fmtMW(d.mw)}</span>
                <span className="font-semibold text-gray-100">{d.pctMW.toFixed(0)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HorizontalBars({
  data,
}: {
  data: Array<{ label: string; value: number; meta?: string; formatted?: string }>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={i} className="text-xs">
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-medium text-gray-100 truncate" title={d.label}>{d.label}</span>
              <span className="font-semibold text-gray-100 ml-2 shrink-0">{d.formatted ?? d.value.toLocaleString()}</span>
            </div>
            <div className="bg-[var(--bg-subtle)] rounded h-3 relative overflow-hidden mb-1">
              <div
                className="h-full bg-gradient-to-r from-[#0D1F3C] to-[#1f3a6e]"
                style={{ width: `${pct}%` }}
              />
            </div>
            {d.meta && <div className="text-[10px] text-gray-500">{d.meta}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CompetitionBars({
  data,
}: {
  data: Array<{ range: string; avg: number; tenderCount: number; max: number }>;
}) {
  const cap = 25;
  return (
    <div className="space-y-3">
      {data.map((c) => {
        const pct = Math.min(100, (c.avg / cap) * 100);
        const color = c.avg < 5 ? "#10b981" : c.avg < 10 ? "#f59e0b" : "#ef4444";
        return (
          <div key={c.range} className="text-xs">
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-medium text-gray-100">{c.range}</span>
              <span className="text-gray-500">
                <span className="font-semibold text-gray-100">{c.avg.toFixed(1)}</span> avg bidders
                {c.tenderCount > 0 && <span> · {c.tenderCount} tender{c.tenderCount === 1 ? "" : "s"}</span>}
                {c.max > 0 && <span> · max {c.max}</span>}
              </span>
            </div>
            <div className="bg-[var(--bg-subtle)] rounded h-3 relative overflow-hidden">
              <div className="h-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-gray-400 mt-2">Green = under 5 bidders typical, amber = moderate, red = crowded.</p>
    </div>
  );
}

export default function AnalyticsPage() {
  return <AuthGuard><AnalyticsContent /></AuthGuard>;
}
