"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type Tender } from "@/lib/firestore";
import { IESA_PROJECTS, IESA_HEADLINE, NATIONAL_TOTAL_TENDERING_MWH } from "@/lib/iesaMarketContext";

type Stage = "All" | "Operational" | "Under Construction" | "Tendering";

const STAGES: Stage[] = ["All", "Operational", "Under Construction", "Tendering"];

const STAGE_COLOR: Record<Exclude<Stage, "All">, string> = {
  "Operational": "#10b981",
  "Under Construction": "#f59e0b",
  "Tendering": "#3b82f6",
};

// Tile cartogram of India — each state mapped to a (row, col) on a 9×7 grid
// that roughly mirrors the country's geography. Cleaner to read than a
// distorted choropleth and dodges the J&K boundary politics entirely (each
// state including Ladakh + J&K gets its own labelled tile).
type GridPos = { row: number; col: number; label: string };
const STATE_GRID: Record<string, GridPos> = {
  "Ladakh":            { row: 1, col: 3, label: "Ladakh" },
  "Jammu & Kashmir":   { row: 2, col: 2, label: "J&K" },
  "Himachal Pradesh":  { row: 2, col: 3, label: "Himachal" },
  "Uttarakhand":       { row: 2, col: 4, label: "Uttarakhand" },
  "Punjab":            { row: 3, col: 2, label: "Punjab" },
  "Haryana":           { row: 3, col: 3, label: "Haryana" },
  "Delhi":             { row: 3, col: 4, label: "Delhi" },
  "Sikkim":            { row: 3, col: 6, label: "Sikkim" },
  "Arunachal Pradesh": { row: 3, col: 7, label: "Arunachal" },
  "Rajasthan":         { row: 4, col: 1, label: "Rajasthan" },
  "Uttar Pradesh":     { row: 4, col: 4, label: "UP" },
  "Bihar":             { row: 4, col: 5, label: "Bihar" },
  "Assam":             { row: 4, col: 6, label: "Assam" },
  "Nagaland":          { row: 4, col: 7, label: "Nagaland" },
  "Gujarat":           { row: 5, col: 1, label: "Gujarat" },
  "Madhya Pradesh":    { row: 5, col: 3, label: "MP" },
  "Jharkhand":         { row: 5, col: 4, label: "Jharkhand" },
  "West Bengal":       { row: 5, col: 5, label: "WB" },
  "Meghalaya":         { row: 5, col: 6, label: "Meghalaya" },
  "Manipur":           { row: 5, col: 7, label: "Manipur" },
  "Maharashtra":       { row: 6, col: 2, label: "Maharashtra" },
  "Chhattisgarh":      { row: 6, col: 3, label: "Chhattisgarh" },
  "Odisha":            { row: 6, col: 5, label: "Odisha" },
  "Tripura":           { row: 6, col: 6, label: "Tripura" },
  "Mizoram":           { row: 6, col: 7, label: "Mizoram" },
  "Goa":               { row: 7, col: 2, label: "Goa" },
  "Karnataka":         { row: 7, col: 3, label: "Karnataka" },
  "Telangana":         { row: 7, col: 4, label: "Telangana" },
  "Andhra Pradesh":    { row: 7, col: 5, label: "AP" },
  "Kerala":            { row: 8, col: 3, label: "Kerala" },
  "Tamil Nadu":        { row: 8, col: 4, label: "TN" },
  "Puducherry":        { row: 8, col: 5, label: "Pondy" },
  "Lakshadweep":       { row: 9, col: 2, label: "Lakshadweep" },
  "Andaman and Nicobar": { row: 9, col: 6, label: "A&N" },
};

// Normalise the various spellings the live data uses ("Andhra Pradesh",
// "andhra pradesh", "AP", "Jammu and Kashmir" etc.) to the canonical keys
// in STATE_GRID. Anything unrecognised → "Pan-India".
function normState(raw: string | null | undefined): string {
  if (!raw) return "Pan-India";
  const s = raw.trim();
  // Exact match
  if (STATE_GRID[s]) return s;
  const lower = s.toLowerCase();
  for (const key of Object.keys(STATE_GRID)) {
    if (key.toLowerCase() === lower) return key;
  }
  // Common variants
  const aliases: Record<string, string> = {
    "j&k": "Jammu & Kashmir",
    "jammu and kashmir": "Jammu & Kashmir",
    "jandk": "Jammu & Kashmir",
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
    "ncr": "Delhi",
    "andaman & nicobar": "Andaman and Nicobar",
    "andaman & nicobar islands": "Andaman and Nicobar",
    "dnh": "Pan-India",
    "diu": "Pan-India",
    "daman & diu": "Pan-India",
    "pan india": "Pan-India",
    "all india": "Pan-India",
    "multiple loctions": "Pan-India",
    "multiple locations": "Pan-India",
  };
  if (aliases[lower]) return aliases[lower];
  // Substring fallback — handles "Bikaner, Rajasthan" etc.
  for (const key of Object.keys(STATE_GRID)) {
    if (lower.includes(key.toLowerCase())) return key;
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

export default function IndiaBessMap({ liveTenders }: { liveTenders: Tender[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("All");
  const [pinnedState, setPinnedState] = useState<string | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);

  // ── Aggregate per state ──
  const { rows, panIndia, ingroTenderingMwh } = useMemo(() => {
    const byState = new Map<string, StateRow>();
    const ensure = (s: string): StateRow => {
      if (!byState.has(s)) byState.set(s, { state: s, operationalMwh: 0, ucMwh: 0, tenderingMwh: 0, projects: [] });
      return byState.get(s)!;
    };

    // 1. IESA snapshot (Operational + Under Construction)
    for (const p of IESA_PROJECTS) {
      const s = p.state === "Pan-India" ? "Pan-India" : normState(p.state);
      const row = ensure(s);
      if (p.stage === "Operational") row.operationalMwh += p.mwh;
      if (p.stage === "Under Construction") row.ucMwh += p.mwh;
      row.projects.push({ name: p.name, mwh: p.mwh, mw: p.mw, stage: p.stage, type: p.type });
    }

    // 2. Live Firestore tenders (Tendering layer)
    let ingroTotal = 0;
    for (const t of liveTenders) {
      if (!isLiveActive(t)) continue;
      const mwh = t.energyMWh || 0;
      if (mwh <= 0) continue;
      const s = normState(t.state);
      const row = ensure(s);
      row.tenderingMwh += mwh;
      ingroTotal += mwh;
      row.projects.push({
        name: `${t.authority || "?"} ${t.powerMW || "?"}MW/${t.energyMWh || "?"}MWh`,
        mwh,
        mw: t.powerMW,
        stage: "Tendering",
        type: t.category || "Standalone",
        nit: t.nitNumber,
      });
    }

    const allRows = Array.from(byState.values());
    const panIndia = allRows.find((r) => r.state === "Pan-India") || null;
    const realRows = allRows.filter((r) => r.state !== "Pan-India");

    return { rows: realRows, panIndia, ingroTenderingMwh: ingroTotal };
  }, [liveTenders]);

  // Total MWh per state under the currently-selected stage filter
  const tileValue = (r: StateRow): number => {
    if (stage === "All") return r.operationalMwh + r.ucMwh + r.tenderingMwh;
    if (stage === "Operational") return r.operationalMwh;
    if (stage === "Under Construction") return r.ucMwh;
    if (stage === "Tendering") return r.tenderingMwh;
    return 0;
  };

  const maxValue = Math.max(1, ...rows.map(tileValue));

  // Logarithmic colour ramp so states with 50 MWh aren't invisible next to
  // a state with 5 GWh. Maps tileValue → green→amber→red intensity that
  // matches the rest of the analytics palette.
  const tileColor = (r: StateRow): string => {
    const v = tileValue(r);
    if (v <= 0) return "var(--bg-subtle)";
    const t = Math.log10(1 + v) / Math.log10(1 + maxValue);
    // Build a single-hue ramp keyed to the selected stage so the user can
    // tell at a glance which layer they're looking at.
    if (stage === "Operational") return interp("#d1fae5", "#047857", t);
    if (stage === "Under Construction") return interp("#fef3c7", "#b45309", t);
    if (stage === "Tendering") return interp("#dbeafe", "#1d4ed8", t);
    // All-stages: cycle through stage colours so cards still feel related
    return interp("#e0f2fe", "#0d2c5e", t);
  };

  const activeStateRow = (s: string | null): StateRow | null => {
    if (!s) return null;
    return rows.find((r) => r.state === s) || null;
  };
  const focused = activeStateRow(pinnedState) || activeStateRow(hoveredState);

  // Pre-build (row, col) → cell metadata for grid rendering
  const cells = Object.entries(STATE_GRID).map(([state, pos]) => {
    const row = rows.find((r) => r.state === state);
    return { state, pos, row };
  });

  const totalIngroGWh = ingroTenderingMwh / 1000;
  const ingroShareOfNational = (ingroTenderingMwh / NATIONAL_TOTAL_TENDERING_MWH) * 100;

  return (
    <div className="space-y-4">
      {/* Headline tile mirroring Ankit's PDF top line */}
      <div className="bg-gradient-to-r from-[#0D1F3C] to-[#1f3a6e] text-white rounded-xl p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-75">India BESS market — April 2026</div>
            <div className="text-[11px] opacity-60 mt-0.5">Source: IESA / Rehman deck + live scraper pipeline</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <HeadlineChip label="Operational" value={`${IESA_HEADLINE.operationalGWh} GWh`} accent={STAGE_COLOR["Operational"]} />
          <HeadlineChip label="Under Construction" value={`${IESA_HEADLINE.underConstructionGWh} GWh`} accent={STAGE_COLOR["Under Construction"]} />
          <HeadlineChip label="Tendering (national)" value={`${IESA_HEADLINE.tenderingGWh} GWh`} accent={STAGE_COLOR["Tendering"]} />
          <HeadlineChip label="Merchant fleet" value={`${IESA_HEADLINE.merchantMW.toLocaleString("en-IN")} MW`} sub={`${IESA_HEADLINE.merchantMWh.toLocaleString("en-IN")} MWh`} accent="#a78bfa" />
          <HeadlineChip
            label="Ingro pipeline"
            value={totalIngroGWh >= 1 ? `${totalIngroGWh.toFixed(1)} GWh` : `${Math.round(ingroTenderingMwh).toLocaleString("en-IN")} MWh`}
            sub={`${ingroShareOfNational.toFixed(1)}% of tendering`}
            accent="#10b981"
          />
        </div>
      </div>

      {/* Stage toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 mr-1">Stage:</span>
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              stage === s
                ? "bg-[#0D1F3C] text-white"
                : "border text-gray-500 hover:bg-[var(--bg-subtle)]"
            }`}
            style={stage === s && s !== "All" ? { background: STAGE_COLOR[s] } : undefined}
          >
            {s}
          </button>
        ))}
        {pinnedState && (
          <button
            onClick={() => setPinnedState(null)}
            className="ml-auto text-xs text-gray-500 hover:text-gray-100"
          >
            Clear selection ({pinnedState}) ×
          </button>
        )}
      </div>

      {/* Map + details panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* The tile cartogram */}
        <div className="bg-[var(--bg-card)] border rounded-xl p-4 overflow-x-auto">
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateRows: "repeat(9, minmax(36px, auto))",
              gridTemplateColumns: "repeat(7, minmax(70px, 1fr))",
            }}
          >
            {cells.map(({ state, pos, row }) => {
              const value = row ? tileValue(row) : 0;
              const isHover = hoveredState === state;
              const isPinned = pinnedState === state;
              return (
                <button
                  key={state}
                  onMouseEnter={() => setHoveredState(state)}
                  onMouseLeave={() => setHoveredState(null)}
                  onClick={() => setPinnedState(pinnedState === state ? null : state)}
                  style={{
                    gridRow: pos.row,
                    gridColumn: pos.col,
                    background: row ? tileColor(row) : "var(--bg-subtle)",
                    outline: isPinned ? "2px solid #0D1F3C" : isHover ? "1px solid #0D1F3C" : "none",
                    outlineOffset: 1,
                  }}
                  className={`rounded-md p-2 text-left transition-all ${
                    value > 0 ? "cursor-pointer hover:scale-[1.02]" : "cursor-default opacity-50"
                  }`}
                >
                  <div
                    className="text-[10px] font-semibold leading-tight truncate"
                    style={{ color: value > 0 && tileValue(row!) > maxValue * 0.4 ? "white" : "var(--text-primary)" }}
                  >
                    {pos.label}
                  </div>
                  {value > 0 && (
                    <div
                      className="text-[9px] mt-0.5 font-medium"
                      style={{ color: tileValue(row!) > maxValue * 0.4 ? "rgba(255,255,255,0.85)" : "var(--text-muted)" }}
                    >
                      {fmtMwh(value)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-4 text-[11px] text-gray-500">
            <span>Less</span>
            <div
              className="flex-1 h-2 rounded"
              style={{
                background: stage === "Operational" ? "linear-gradient(to right, #d1fae5, #047857)"
                  : stage === "Under Construction" ? "linear-gradient(to right, #fef3c7, #b45309)"
                  : stage === "Tendering" ? "linear-gradient(to right, #dbeafe, #1d4ed8)"
                  : "linear-gradient(to right, #e0f2fe, #0d2c5e)",
              }}
            />
            <span>More — {fmtMwh(maxValue)} max</span>
          </div>

          {/* Pan-India unallocated card */}
          {panIndia && (panIndia.operationalMwh + panIndia.ucMwh + panIndia.tenderingMwh) > 0 && (
            <div className="mt-4 bg-[var(--bg-subtle)] rounded-lg p-3 border-l-4 border-violet-500">
              <div className="text-xs font-semibold text-gray-100">Pan-India / Unallocated</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Central tenders (SECI / NHPC / NTPC / SJVN) where the host state hasn&apos;t been announced yet. Move into a state when site location is published.
              </div>
              <div className="flex flex-wrap gap-3 mt-2 text-xs">
                {panIndia.operationalMwh > 0 && <span><span className="text-gray-400">Op:</span> <span className="text-gray-100 font-semibold">{fmtMwh(panIndia.operationalMwh)}</span></span>}
                {panIndia.ucMwh > 0 && <span><span className="text-gray-400">UC:</span> <span className="text-gray-100 font-semibold">{fmtMwh(panIndia.ucMwh)}</span></span>}
                {panIndia.tenderingMwh > 0 && <span><span className="text-gray-400">Tendering:</span> <span className="text-gray-100 font-semibold">{fmtMwh(panIndia.tenderingMwh)}</span></span>}
                <span className="text-gray-400 ml-auto">{panIndia.projects.length} project{panIndia.projects.length === 1 ? "" : "s"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right rail — focused state details */}
        <div className="bg-[var(--bg-card)] border rounded-xl p-4">
          {focused ? (
            <FocusedState
              row={focused}
              pinned={pinnedState === focused.state}
              onTenderClick={(nit) => router.push(`/tender/${encodeURIComponent(nit)}?from=/analytics`)}
            />
          ) : (
            <div className="text-xs text-gray-500 text-center py-8">
              Hover or click a state tile to see its BESS projects.
            </div>
          )}
        </div>
      </div>

      {/* Fallback table */}
      <details className="bg-[var(--bg-card)] border rounded-xl">
        <summary className="px-4 py-3 text-sm font-semibold text-gray-100 cursor-pointer select-none">
          Show data table (screen-reader friendly · copy-paste into a deck)
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
  );
}

function HeadlineChip({
  label, value, sub, accent,
}: { label: string; value: string; sub?: string; accent?: string }) {
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
  const top = [...row.projects].sort((a, b) => b.mwh - a.mwh).slice(0, 8);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-100">{row.state}</h3>
        {pinned && <span className="text-[10px] text-[#0D1F3C] bg-[#0D1F3C]/10 px-2 py-0.5 rounded">pinned</span>}
      </div>
      <div className="text-xs text-gray-500 mb-3">{fmtMwh(total)} total · {row.projects.length} project{row.projects.length === 1 ? "" : "s"}</div>

      <div className="space-y-1.5 mb-4">
        <StageRow label="Operational" value={row.operationalMwh} color={STAGE_COLOR["Operational"]} />
        <StageRow label="Under Construction" value={row.ucMwh} color={STAGE_COLOR["Under Construction"]} />
        <StageRow label="Tendering" value={row.tenderingMwh} color={STAGE_COLOR["Tendering"]} />
      </div>

      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Top projects</div>
      <div className="space-y-1">
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
                    p.stage === "Operational" ? STAGE_COLOR["Operational"]
                    : p.stage === "Under Construction" ? STAGE_COLOR["Under Construction"]
                    : STAGE_COLOR["Tendering"],
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

function StageRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="inline-block w-2 h-2 rounded" style={{ background: color }} />
      <span className="text-gray-500 flex-1">{label}</span>
      <span className="text-gray-100 font-semibold">{value > 0 ? fmtMwh(value) : "—"}</span>
    </div>
  );
}

// ── colour interp helper ──
function interp(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
