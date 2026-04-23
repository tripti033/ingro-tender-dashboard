"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getTenders, type Tender } from "@/lib/firestore";
import { findComparables, tariffStats, keyDifferentiators } from "@/lib/comparables";

function formatINR(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function formatTariff(n: number | null | undefined): string {
  if (n == null) return "—";
  // ₹/MW/Month — show in Lakhs for readability
  return `₹${(n / 100000).toFixed(2)}L`;
}

function formatAwardDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  } catch { return "—"; }
}

export default function ComparableTendersCard({ tender }: { tender: Tender }) {
  const [allTenders, setAllTenders] = useState<Tender[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    getTenders().then(setAllTenders).catch(() => setAllTenders([]));
  }, []);

  const comparables = useMemo(() => {
    if (!allTenders) return [];
    return findComparables(tender, allTenders).filter((c) => !excluded.has(c.nitNumber));
  }, [tender, allTenders, excluded]);

  const stats = useMemo(() => tariffStats(comparables), [comparables]);
  const notes = useMemo(() => keyDifferentiators(tender, comparables), [tender, comparables]);

  if (allTenders === null) {
    return (
      <div className="bg-white rounded-lg border p-5 mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Comparable Tenders</h2>
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (comparables.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-5 mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Comparable Tenders</h2>
        <p className="text-sm text-gray-500">
          No awarded tenders in the database match this one on duration / capacity yet.
          Run <code className="bg-gray-100 px-1 rounded">node scraper/result-tracker.js</code> to
          pick up newly-awarded tenders, or <code className="bg-gray-100 px-1 rounded">node scraper/seed-comparables.js</code> for historical benchmarks.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Comparable Tenders ({comparables.length})
        </h2>
        {excluded.size > 0 && (
          <button
            onClick={() => setExcluded(new Set())}
            className="text-xs text-[#0D1F3C] hover:underline"
          >
            Reset (show {excluded.size} excluded)
          </button>
        )}
      </div>

      {/* Tariff band summary */}
      {stats && (
        <div className="bg-gradient-to-r from-green-50 to-amber-50 border border-green-100 rounded-lg p-4 mb-4">
          <div className="text-xs text-gray-600 mb-1">
            Estimated tariff range based on {stats.count} comparable{stats.count === 1 ? "" : "s"}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <div>
              <span className="text-2xl font-bold text-gray-900">{formatTariff(stats.median)}</span>
              <span className="text-xs text-gray-500 ml-1">median /MW/Mo</span>
            </div>
            <div className="text-sm text-gray-600">
              Range: <span className="font-semibold">{formatTariff(stats.min)}</span>
              {" – "}
              <span className="font-semibold">{formatTariff(stats.max)}</span>
            </div>
            <div className="text-xs text-gray-500">
              Mean {formatTariff(stats.mean)}
            </div>
          </div>
          {notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-gray-700 list-disc list-inside">
              {notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-500 uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Tender</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">MW / MWh</th>
              <th className="px-3 py-2 text-right">Dur</th>
              <th className="px-3 py-2 text-right">Cyc</th>
              <th className="px-3 py-2">VGF</th>
              <th className="px-3 py-2 text-right">Tariff</th>
              <th className="px-3 py-2">Winner</th>
              <th className="px-3 py-2">Awarded</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparables.map((c) => {
              const sameBand = c.tariffBand === tender.tariffBand;
              return (
                <tr key={c.nitNumber} className={`hover:bg-gray-50 ${sameBand ? "bg-green-50/30" : ""}`}>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => router.push(`/tender/${encodeURIComponent(c.nitNumber)}?from=/tender/${encodeURIComponent(tender.nitNumber)}`)}
                      className="text-[#0D1F3C] hover:underline text-left max-w-[280px] truncate block"
                      title={c.title || c.nitNumber}
                    >
                      {c.title?.split(" — ")[0] || c.nitNumber}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{c.state || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {c.powerMW ?? "—"} / {c.energyMWh ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{c.durationHours != null ? `${c.durationHours}h` : "—"}</td>
                  <td className="px-3 py-2 text-right">{c.cyclesPerDay ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.tariffBand ? (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        c.tariffBand === "VGF2" ? "bg-green-100 text-green-700"
                        : c.tariffBand === "VGF1" ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-600"
                      }`}>
                        {c.tariffBand}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">
                    {formatTariff(c.tariffRsPerMwPerMonth)}
                  </td>
                  <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={c.awardedTo || ""}>
                    {c.awardedTo || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatAwardDate(c.awardDate)}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setExcluded((prev) => new Set(prev).add(c.nitNumber))}
                      title="Exclude this comparable from the range"
                      className="text-gray-300 hover:text-red-500 text-sm leading-none"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-gray-400">
        EMD/PBG values and bid capacity not shown for brevity. Click any row to open that tender.
        Green rows = same VGF band as this tender. Total cost shown as ₹/MW/Month (divide by 1 Lakh for ₹L/MW/Mo).
      </div>
    </div>
  );
}
