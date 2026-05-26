"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleLinear } from "d3-scale";
import { getTenders, type Tender } from "@/lib/firestore";
import { IESA_PROJECTS, IESA_HEADLINE, NATIONAL_TOTAL_TENDERING_MWH } from "@/lib/iesaMarketContext";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

type Stage = "All" | "Operational" | "Under Construction" | "Tendering";
const STAGES: Stage[] = ["All", "Operational", "Under Construction", "Tendering"];

const STAGE_COLOR: Record<Exclude<Stage, "All">, string> = {
  "Operational": "#10b981",
  "Under Construction": "#f59e0b",
  "Tendering": "#3b82f6",
};

const STAGE_RAMP: Record<Stage, [string, string]> = {
  "All":                ["#e0f2fe", "#0d2c5e"],
  "Operational":        ["#d1fae5", "#047857"],
  "Under Construction": ["#fef3c7", "#b45309"],
  "Tendering":          ["#dbeafe", "#1d4ed8"],
};

// Match the live data spellings ("AP", "Andhra Pradesh", "Bikaner, Rajasthan")
// against the canonical names in our india-states TopoJSON.
const TOPO_STATE_NAMES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam",
  "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

function normState(raw: string | null | undefined): string {
  if (!raw) return "Pan-India";
  const s = raw.trim();
  if (TOPO_STATE_NAMES.includes(s)) return s;
  const lower = s.toLowerCase();
  for (const k of TOPO_STATE_NAMES) {
    if (k.toLowerCase() === lower) return k;
  }
  const aliases: Record<string, string> = {
    "j&k": "Jammu and Kashmir",
    "jammu & kashmir": "Jammu and Kashmir",
    "ap": "Andhra Pradesh",
    "tn": "Tamil Nadu",
    "mp": "Madhya Pradesh",
    "up": "Uttar Pradesh",
    "wb": "West Bengal",
    "hp": "Himachal Pradesh",
    "uk": "Uttarakhand",
    "uttaranchal": "Uttarakhand",
    "orissa": "Odisha",
    "nct of delhi": "Delhi",
    "andaman & nicobar": "Andaman and Nicobar Islands",
    "andaman & nicobar islands": "Andaman and Nicobar Islands",
    "andaman and nicobar": "Andaman and Nicobar Islands",
    "dnh": "Dadra and Nagar Haveli and Daman and Diu",
    "diu": "Dadra and Nagar Haveli and Daman and Diu",
    "daman & diu": "Dadra and Nagar Haveli and Daman and Diu",
    "pan india": "Pan-India",
    "all india": "Pan-India",
    "multiple loctions": "Pan-India",
    "multiple locations": "Pan-India",
  };
  if (aliases[lower]) return aliases[lower];
  for (const k of TOPO_STATE_NAMES) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return "Pan-India";
}

type StateRow = {
  state: string;
  operationalMwh: number;
  ucMwh: number;
  tenderingMwh: number;
  projects: Array<{ name: string; mwh: number; mw: number | null; stage: string; type: string; nit?: string }>;
};

function fmtMwh(mwh: number): string {
  if (mwh >= 1000) return `${(mwh / 1000).toFixed(1)} GWh`;
  if (mwh >= 1) return `${Math.round(mwh).toLocaleString("en-IN")} MWh`;
  return mwh.toFixed(1) + " MWh";
}

function fmtMw(mw: number | null): string {
  if (mw == null) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw).toLocaleString("en-IN")} MW`;
}

function isLiveActive(t: Tender): boolean {
  if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") return false;
  if ((t.sources || []).includes("excel-comparables-seed")) return false;
  if (t.bidDeadline) {
    try {
      const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
      if (d.getTime() < Date.now()) return false;
    } catch { /* fall through */ }
  }
  return true;
}

function MapContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("All");
  const [pinnedState, setPinnedState] = useState<string | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    getTenders().then(setTenders).finally(() => setLoading(false));
  }, []);

  const { rows, byState, panIndia, ingroTenderingMwh } = useMemo(() => {
    const byState = new Map<string, StateRow>();
    const ensure = (s: string): StateRow => {
      if (!byState.has(s)) byState.set(s, { state: s, operationalMwh: 0, ucMwh: 0, tenderingMwh: 0, projects: [] });
      return byState.get(s)!;
    };

    for (const p of IESA_PROJECTS) {
      const s = p.state === "Pan-India" ? "Pan-India" : normState(p.state);
      const row = ensure(s);
      if (p.stage === "Operational") row.operationalMwh += p.mwh;
      if (p.stage === "Under Construction") row.ucMwh += p.mwh;
      row.projects.push({ name: p.name, mwh: p.mwh, mw: p.mw, stage: p.stage, type: p.type });
    }

    let ingroTotal = 0;
    for (const t of tenders) {
      if (!isLiveActive(t)) continue;
      const mwh = t.energyMWh || 0;
      if (mwh <= 0) continue;
      const s = normState(t.state);
      const row = ensure(s);
      row.tenderingMwh += mwh;
      ingroTotal += mwh;
      row.projects.push({
        name: `${t.authority || "?"} ${t.powerMW || "?"}MW/${t.energyMWh || "?"}MWh`,
        mwh, mw: t.powerMW, stage: "Tendering",
        type: t.category || "Standalone", nit: t.nitNumber,
      });
    }

    const allRows = Array.from(byState.values());
    const panIndia = allRows.find((r) => r.state === "Pan-India") || null;
    const realRows = allRows.filter((r) => r.state !== "Pan-India");
    return { rows: realRows, byState, panIndia, ingroTenderingMwh: ingroTotal };
  }, [tenders]);

  const tileValue = (r: StateRow | undefined): number => {
    if (!r) return 0;
    if (stage === "All") return r.operationalMwh + r.ucMwh + r.tenderingMwh;
    if (stage === "Operational") return r.operationalMwh;
    if (stage === "Under Construction") return r.ucMwh;
    return r.tenderingMwh;
  };

  const maxValue = Math.max(1, ...rows.map((r) => tileValue(r)));

  // Log scale so a state with 50 MWh isn't invisible next to a 5 GWh state.
  const colorScale = useMemo(() => {
    const [from, to] = STAGE_RAMP[stage];
    return scaleLinear<string>()
      .domain([0, Math.log10(1 + maxValue)])
      .range([from, to])
      .clamp(true);
  }, [stage, maxValue]);

  const focused = pinnedState ?? hoveredState;
  const focusedRow = focused ? byState.get(focused) : null;

  const totalIngroGWh = ingroTenderingMwh / 1000;
  const ingroShareOfNational = (ingroTenderingMwh / NATIONAL_TOTAL_TENDERING_MWH) * 100;

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />

      <div className="sidebar-content sticky top-0 z-40 bg-[var(--bg-card)] border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-100">India BESS Map</h1>
          <span className="text-xs text-gray-400 hidden md:inline">National market context · April 2026</span>
          <div className="ml-auto flex flex-wrap gap-1 text-xs">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  stage === s ? "bg-[#0D1F3C] text-white" : "border text-gray-500 hover:bg-[var(--bg-subtle)]"
                }`}
                style={stage === s && s !== "All" ? { background: STAGE_COLOR[s] } : undefined}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-content px-6 py-6 max-w-7xl space-y-5">
        {/* Headline */}
        <div className="bg-gradient-to-r from-[#0D1F3C] to-[#1f3a6e] text-white rounded-xl p-4">
          <div className="text-xs uppercase tracking-wider opacity-75 mb-1">India BESS market — April 2026</div>
          <div className="text-[11px] opacity-60 mb-3">Source: IESA / Rehman deck + live scraper pipeline</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <Chip label="Operational" value={`${IESA_HEADLINE.operationalGWh} GWh`} accent={STAGE_COLOR.Operational} />
            <Chip label="Under Construction" value={`${IESA_HEADLINE.underConstructionGWh} GWh`} accent={STAGE_COLOR["Under Construction"]} />
            <Chip label="Tendering (national)" value={`${IESA_HEADLINE.tenderingGWh} GWh`} accent={STAGE_COLOR.Tendering} />
            <Chip label="Merchant fleet" value={`${IESA_HEADLINE.merchantMW.toLocaleString("en-IN")} MW`} sub={`${IESA_HEADLINE.merchantMWh.toLocaleString("en-IN")} MWh`} accent="#a78bfa" />
            <Chip
              label="Ingro pipeline"
              value={totalIngroGWh >= 1 ? `${totalIngroGWh.toFixed(1)} GWh` : `${Math.round(ingroTenderingMwh).toLocaleString("en-IN")} MWh`}
              sub={`${ingroShareOfNational.toFixed(1)}% of tendering`}
              accent="#10b981"
            />
          </div>
        </div>

        {/* Map + side panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div
            className="bg-[var(--bg-card)] border rounded-xl p-4 relative"
            onMouseMove={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
          >
            {loading ? (
              <div className="h-[480px] bg-gray-800/30 rounded animate-pulse" />
            ) : (
              <>
                <ComposableMap
                  projection="geoMercator"
                  projectionConfig={{ scale: 1000, center: [82, 23] }}
                  width={760}
                  height={520}
                  style={{ width: "100%", height: "auto" }}
                >
                  <Geographies geography="/geo/india-states.topo.json">
                    {({ geographies }) =>
                      geographies.map((geo) => {
                        const stateName = geo.properties.st_nm as string;
                        const row = byState.get(stateName);
                        const v = tileValue(row);
                        const isFocused = focused === stateName;
                        const fill = v > 0 ? colorScale(Math.log10(1 + v)) : "var(--bg-subtle)";
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            fill={fill}
                            stroke="#ffffff"
                            strokeWidth={isFocused ? 2 : 0.5}
                            style={{
                              default: { outline: "none", cursor: v > 0 ? "pointer" : "default" },
                              hover: { outline: "none", fill: v > 0 ? "#0D1F3C" : fill, cursor: v > 0 ? "pointer" : "default" },
                              pressed: { outline: "none" },
                            }}
                            onMouseEnter={() => setHoveredState(stateName)}
                            onMouseLeave={() => setHoveredState(null)}
                            onClick={() => v > 0 && setPinnedState(pinnedState === stateName ? null : stateName)}
                          />
                        );
                      })
                    }
                  </Geographies>
                </ComposableMap>

                {/* Tooltip — floats with cursor */}
                {hoveredState && tooltip && (() => {
                  const r = byState.get(hoveredState);
                  if (!r) return null;
                  const total = r.operationalMwh + r.ucMwh + r.tenderingMwh;
                  return (
                    <div
                      className="absolute pointer-events-none bg-[#0D1F3C] text-white rounded-lg px-3 py-2 text-xs shadow-lg z-10"
                      style={{
                        left: Math.min(tooltip.x + 14, 600),
                        top: Math.max(tooltip.y - 60, 8),
                        minWidth: 180,
                      }}
                    >
                      <div className="font-bold mb-1">{hoveredState}</div>
                      <div className="opacity-75 mb-1.5">{fmtMwh(total)} total · {r.projects.length} project{r.projects.length === 1 ? "" : "s"}</div>
                      <div className="space-y-0.5 opacity-90">
                        {r.operationalMwh > 0 && <div><span style={{ color: STAGE_COLOR.Operational }}>●</span> Operational: {fmtMwh(r.operationalMwh)}</div>}
                        {r.ucMwh > 0 && <div><span style={{ color: STAGE_COLOR["Under Construction"] }}>●</span> Under Construction: {fmtMwh(r.ucMwh)}</div>}
                        {r.tenderingMwh > 0 && <div><span style={{ color: STAGE_COLOR.Tendering }}>●</span> Tendering: {fmtMwh(r.tenderingMwh)}</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* Legend */}
                <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500">
                  <span>Less</span>
                  <div
                    className="flex-1 h-2 rounded"
                    style={{ background: `linear-gradient(to right, ${STAGE_RAMP[stage][0]}, ${STAGE_RAMP[stage][1]})` }}
                  />
                  <span>More — {fmtMwh(maxValue)} max · {stage === "All" ? "all stages" : stage}</span>
                </div>

                {pinnedState && (
                  <button
                    onClick={() => setPinnedState(null)}
                    className="mt-2 text-xs text-gray-500 hover:text-gray-100"
                  >
                    Clear pin ({pinnedState}) ×
                  </button>
                )}
              </>
            )}
          </div>

          {/* Right rail */}
          <div className="space-y-3">
            <div className="bg-[var(--bg-card)] border rounded-xl p-4">
              {focusedRow ? (
                <FocusedState
                  row={focusedRow}
                  pinned={pinnedState === focusedRow.state}
                  onTenderClick={(nit) => router.push(`/tender/${encodeURIComponent(nit)}?from=/map`)}
                />
              ) : (
                <div className="text-xs text-gray-500 text-center py-6">
                  Hover or click a state on the map to see its BESS projects.
                </div>
              )}
            </div>

            {panIndia && (panIndia.operationalMwh + panIndia.ucMwh + panIndia.tenderingMwh) > 0 && (
              <div className="bg-[var(--bg-card)] border rounded-xl p-4 border-l-4 border-l-violet-500">
                <div className="text-xs font-semibold text-gray-100">Pan-India / Unallocated</div>
                <div className="text-[11px] text-gray-500 mt-0.5 mb-2">
                  Central FDRE / RTC tenders without a host state announced yet.
                </div>
                <div className="space-y-1 text-xs">
                  {panIndia.operationalMwh > 0 && <div><span className="text-gray-400">Op:</span> <span className="text-gray-100 font-semibold">{fmtMwh(panIndia.operationalMwh)}</span></div>}
                  {panIndia.ucMwh > 0 && <div><span className="text-gray-400">UC:</span> <span className="text-gray-100 font-semibold">{fmtMwh(panIndia.ucMwh)}</span></div>}
                  {panIndia.tenderingMwh > 0 && <div><span className="text-gray-400">Tendering:</span> <span className="text-gray-100 font-semibold">{fmtMwh(panIndia.tenderingMwh)}</span></div>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fallback table */}
        <details className="bg-[var(--bg-card)] border rounded-xl">
          <summary className="px-4 py-3 text-sm font-semibold text-gray-100 cursor-pointer select-none">
            Show data table (sortable · copy-paste-friendly)
          </summary>
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3 text-right">Operational</th>
                  <th className="py-2 pr-3 text-right">Under Construction</th>
                  <th className="py-2 pr-3 text-right">Tendering (live)</th>
                  <th className="py-2 pr-3 text-right">Total MWh</th>
                  <th className="py-2 pr-3 text-right">Projects</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {[...rows, ...(panIndia ? [panIndia] : [])]
                  .filter((r) => r.operationalMwh + r.ucMwh + r.tenderingMwh > 0)
                  .sort((a, b) =>
                    (b.operationalMwh + b.ucMwh + b.tenderingMwh) - (a.operationalMwh + a.ucMwh + a.tenderingMwh)
                  )
                  .map((r) => {
                    const total = r.operationalMwh + r.ucMwh + r.tenderingMwh;
                    return (
                      <tr key={r.state} className="hover:bg-[var(--bg-subtle)]">
                        <td className="py-2 pr-3 text-gray-100 font-medium">{r.state}</td>
                        <td className="py-2 pr-3 text-right">{r.operationalMwh > 0 ? fmtMwh(r.operationalMwh) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{r.ucMwh > 0 ? fmtMwh(r.ucMwh) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{r.tenderingMwh > 0 ? fmtMwh(r.tenderingMwh) : "—"}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-gray-100">{fmtMwh(total)}</td>
                        <td className="py-2 pr-3 text-right text-gray-500">{r.projects.length}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

function Chip({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white/10 rounded-lg p-3 border-l-4" style={{ borderLeftColor: accent || "white" }}>
      <div className="text-[10px] uppercase tracking-wider opacity-75 leading-tight">{label}</div>
      <div className="text-lg font-bold mt-1 leading-tight">{value}</div>
      {sub && <div className="text-[10px] opacity-75 mt-0.5">{sub}</div>}
    </div>
  );
}

function FocusedState({
  row, pinned, onTenderClick,
}: {
  row: StateRow;
  pinned: boolean;
  onTenderClick: (nit: string) => void;
}) {
  const total = row.operationalMwh + row.ucMwh + row.tenderingMwh;
  const top = [...row.projects].sort((a, b) => b.mwh - a.mwh).slice(0, 10);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-bold text-gray-100">{row.state}</h3>
        {pinned && <span className="text-[10px] text-[#0D1F3C] bg-[#0D1F3C]/10 px-2 py-0.5 rounded">pinned</span>}
      </div>
      <div className="text-xs text-gray-500 mb-3">{fmtMwh(total)} · {row.projects.length} project{row.projects.length === 1 ? "" : "s"}</div>

      <div className="space-y-1.5 mb-4">
        <Row label="Operational" value={row.operationalMwh} color={STAGE_COLOR.Operational} />
        <Row label="Under Construction" value={row.ucMwh} color={STAGE_COLOR["Under Construction"]} />
        <Row label="Tendering" value={row.tenderingMwh} color={STAGE_COLOR.Tendering} />
      </div>

      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Projects</div>
      <div className="space-y-1 max-h-[360px] overflow-y-auto pr-1">
        {top.map((p, i) => (
          <button
            key={i}
            onClick={() => p.nit && onTenderClick(p.nit)}
            disabled={!p.nit}
            className={`w-full text-left text-xs p-1.5 rounded transition-colors ${
              p.nit ? "hover:bg-[var(--bg-subtle)] cursor-pointer" : "cursor-default"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{
                  background:
                    p.stage === "Operational" ? STAGE_COLOR.Operational
                    : p.stage === "Under Construction" ? STAGE_COLOR["Under Construction"]
                    : STAGE_COLOR.Tendering,
                }}
              />
              <span className="text-gray-100 truncate flex-1" title={p.name}>{p.name}</span>
              <span className="text-gray-500 shrink-0">{fmtMwh(p.mwh)}</span>
            </div>
            <div className="text-[10px] text-gray-500 ml-3.5">{p.type} · {p.stage}{p.mw ? ` · ${fmtMw(p.mw)}` : ""}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="inline-block w-2 h-2 rounded" style={{ background: color }} />
      <span className="text-gray-500 flex-1">{label}</span>
      <span className="text-gray-100 font-semibold">{value > 0 ? fmtMwh(value) : "—"}</span>
    </div>
  );
}

export default function MapPage() {
  return <AuthGuard><MapContent /></AuthGuard>;
}
