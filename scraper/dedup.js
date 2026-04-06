/**
 * Deduplicate an array of normalised tenders.
 *
 * Primary dedup: exact NIT number match → same tender.
 * Secondary dedup: if NIT is synthetic, fuzzy match on authority + powerMW + bidDeadline (same day).
 * When duplicates merge: combine sources arrays, keep most complete field values.
 */
export function deduplicate(tenders) {
  const seen = new Map(); // nitNumber → merged tender

  for (const tender of tenders) {
    // Primary dedup: exact NIT match
    if (seen.has(tender.nitNumber)) {
      const existing = seen.get(tender.nitNumber);
      seen.set(tender.nitNumber, mergeTenders(existing, tender));
      continue;
    }

    // Secondary dedup: fuzzy match for synthetic NITs
    // Synthetic NITs start with SOURCE- prefix, so check if we can match by content
    const fuzzyKey = buildFuzzyKey(tender);
    let matched = false;

    if (fuzzyKey) {
      for (const [nit, existing] of seen) {
        const existingKey = buildFuzzyKey(existing);
        if (existingKey && fuzzyKey === existingKey) {
          seen.set(nit, mergeTenders(existing, tender));
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      seen.set(tender.nitNumber, tender);
    }
  }

  const result = Array.from(seen.values());
  const deduped = tenders.length - result.length;
  if (deduped > 0) {
    console.log(
      `[Dedup] Merged ${deduped} duplicate(s), ${result.length} unique tenders remain`
    );
  }

  return result;
}

/**
 * Build a fuzzy key from authority + powerMW + bidDeadline date (YYYY-MM-DD).
 * Returns null if not enough data for meaningful fuzzy matching.
 */
function buildFuzzyKey(tender) {
  if (!tender.authority || !tender.powerMW) return null;

  let dateStr = "nodate";
  if (tender.bidDeadline) {
    // Firestore Timestamp has toDate(), plain dates work too
    const d =
      typeof tender.bidDeadline.toDate === "function"
        ? tender.bidDeadline.toDate()
        : new Date(tender.bidDeadline);

    if (!isNaN(d.getTime())) {
      dateStr = d.toISOString().slice(0, 10);
    }
  }

  return `${tender.authority}|${tender.powerMW}|${dateStr}`;
}

/**
 * Merge two tenders: combine sources arrays, prefer non-null field values.
 * The first tender (existing) is the base; the second (incoming) fills gaps.
 */
function mergeTenders(existing, incoming) {
  const merged = { ...existing };

  // Merge sources arrays without duplicates
  const allSources = new Set([
    ...(existing.sources || []),
    ...(incoming.sources || []),
  ]);
  merged.sources = Array.from(allSources);

  // For each field, prefer the more complete value (non-null over null)
  const fields = [
    "title",
    "category",
    "tenderMode",
    "authority",
    "authorityType",
    "state",
    "location",
    "powerMW",
    "energyMWh",
    "durationHours",
    "connectivityType",
    "emdAmount",
    "emdUnit",
    "biddingStructure",
    "bidDeadline",
    "emdDeadline",
    "preBidDate",
    "techBidOpeningDate",
    "financialBidOpeningDate",
    "bespaSigning",
    "documentLink",
    "preBidLink",
    "sourceUrl",
  ];

  for (const field of fields) {
    if (merged[field] == null && incoming[field] != null) {
      merged[field] = incoming[field];
    }
  }

  // Recompute derived fields if capacity was filled in
  if (merged.powerMW && merged.energyMWh && !merged.durationHours) {
    merged.durationHours =
      Math.round((merged.energyMWh / merged.powerMW) * 100) / 100;
  }

  // VGF: true if either source says true
  merged.vgfEligible = existing.vgfEligible || incoming.vgfEligible;

  return merged;
}
