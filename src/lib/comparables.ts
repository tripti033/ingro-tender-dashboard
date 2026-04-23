import type { Tender } from "./firestore";

/**
 * Find awarded tenders comparable to the target. Used on the tender detail
 * page to give a BD team a tariff band + differentiators for pricing.
 *
 * Matching rules (intentionally loose — BD wants options, not a perfect match):
 *  1. Must have a winning tariff stored
 *  2. Must NOT be the tender itself
 *  3. Duration must be within ± 1 hour (a 2h tender ≠ 4h tender — batteries
 *     are very different)
 *  4. Capacity must be within half-to-double (30 MW matches 15-60 MW range;
 *     500 MW matches 250-1000 MW). This is permissive by design — small
 *     tenders have very few comparables, so widening the window helps.
 *  5. Same contract model if both are set (BOO ↔ BOO, BOOT ↔ BOOT).
 *
 * Ranked by how close they are on tariff band, duration, and recency.
 */
export function findComparables(target: Tender, all: Tender[]): Tender[] {
  if (!target) return [];

  const tDur = target.durationHours ?? null;
  const tMW = target.powerMW ?? null;

  return all
    .filter((t) => {
      if (t.nitNumber === target.nitNumber) return false;
      if (t.tariffRsPerMwPerMonth == null) return false;

      if (tDur != null && t.durationHours != null) {
        if (Math.abs(t.durationHours - tDur) > 1.0) return false;
      }

      if (tMW != null && t.powerMW != null) {
        const ratio = t.powerMW / tMW;
        if (ratio < 0.4 || ratio > 3.0) return false;
      }

      if (target.contractModel && t.contractModel && target.contractModel !== t.contractModel) {
        // Soft penalty in ranking, not a hard filter — very few BOOT samples
        // in most buckets. Let it through, scoring will deprioritise.
      }

      return true;
    })
    .sort((a, b) => {
      // Rank: same VGF band first, then closest duration, then newest.
      const bandA = a.tariffBand === target.tariffBand ? 0 : 1;
      const bandB = b.tariffBand === target.tariffBand ? 0 : 1;
      if (bandA !== bandB) return bandA - bandB;

      const durDiff = (x: Tender) =>
        tDur != null && x.durationHours != null ? Math.abs(x.durationHours - tDur) : 99;
      const dA = durDiff(a);
      const dB = durDiff(b);
      if (dA !== dB) return dA - dB;

      const ts = (t: Tender): number => {
        const d = t.awardDate || t.firstSeenAt;
        return d && typeof d.toDate === "function" ? d.toDate().getTime() : 0;
      };
      return ts(b) - ts(a);
    });
}

/**
 * Summary statistics for the tariff distribution across comparables.
 * Returned values are in ₹/MW/Month. Null when fewer than 2 comparables.
 */
export function tariffStats(comparables: Tender[]): {
  min: number; median: number; max: number; mean: number; count: number;
} | null {
  const tariffs = comparables
    .map((t) => t.tariffRsPerMwPerMonth)
    .filter((x): x is number => typeof x === "number" && x > 0)
    .sort((a, b) => a - b);
  if (tariffs.length < 2) return null;
  const median = tariffs.length % 2 === 1
    ? tariffs[(tariffs.length - 1) / 2]
    : (tariffs[tariffs.length / 2 - 1] + tariffs[tariffs.length / 2]) / 2;
  const mean = tariffs.reduce((s, x) => s + x, 0) / tariffs.length;
  return {
    min: tariffs[0],
    max: tariffs[tariffs.length - 1],
    median,
    mean,
    count: tariffs.length,
  };
}

/**
 * Generate short human-readable notes about how the target differs from the
 * comparable pool — the kind of line a BD person wants to see so they can
 * adjust the bid from benchmark.
 */
export function keyDifferentiators(target: Tender, comparables: Tender[]): string[] {
  const out: string[] = [];
  if (comparables.length === 0) return out;

  // Duration
  if (target.durationHours != null) {
    const durs = comparables.map((c) => c.durationHours).filter((x): x is number => typeof x === "number");
    if (durs.length >= 2) {
      const median = [...durs].sort((a, b) => a - b)[Math.floor(durs.length / 2)];
      if (target.durationHours > median + 0.25) out.push(`Longer duration (${target.durationHours}h vs ${median}h typical) — expect a premium on capex.`);
      else if (target.durationHours < median - 0.25) out.push(`Shorter duration (${target.durationHours}h vs ${median}h typical) — lighter battery sizing.`);
    }
  }

  // VGF band
  if (target.tariffBand && target.tariffBand !== "No-VGF") {
    const bandPeers = comparables.filter((c) => c.tariffBand === target.tariffBand);
    if (bandPeers.length > 0) {
      out.push(`${bandPeers.length} peer${bandPeers.length === 1 ? "" : "s"} in ${target.tariffBand} bucket.`);
    } else {
      out.push(`No direct ${target.tariffBand} peers in the pool — benchmark with care.`);
    }
  } else if (target.tariffBand === "No-VGF") {
    out.push("No VGF support — bid must price in full capex recovery.");
  }

  // Scale
  if (target.powerMW != null) {
    const peersMW = comparables.map((c) => c.powerMW).filter((x): x is number => typeof x === "number");
    if (peersMW.length >= 3) {
      const median = [...peersMW].sort((a, b) => a - b)[Math.floor(peersMW.length / 2)];
      if (target.powerMW < median * 0.3) out.push(`Very small vs pool (${target.powerMW} MW vs ${median} MW typical) — expect a scale-premium.`);
    }
  }

  // Geography
  if (target.geographyType === "Hill") out.push("Hill geography — add transport & construction overhead vs plains peers.");
  if (target.geographyType === "Desert") out.push("Desert geography — consider cooling + dust derating.");
  if (target.geographyType === "Coastal") out.push("Coastal geography — salt corrosion; plan marine-grade enclosures.");

  // Contract model
  if (target.contractModel === "BOOT") {
    const bootPeers = comparables.filter((c) => c.contractModel === "BOOT").length;
    if (bootPeers <= 1) out.push("BOOT model (transfer at end) — most peers are BOO. Residual value is ₹0; price that in.");
  }

  return out;
}
