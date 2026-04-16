/**
 * Deduplicate an array of normalised tenders.
 *
 * Three layers of dedup:
 * 1. Exact NIT number match → same tender
 * 2. Fuzzy: powerMW + energyMWh + bidDeadline (same day) → likely same tender
 * 3. Title similarity: if >60% of words match → likely same tender
 *
 * When duplicate found: merge sources arrays, keep most complete field values.
 * Prefer tenders from direct sources (SECI, NTPC, uktenders) over aggregators (TenderDetail).
 */
export function deduplicate(tenders) {
  // Sort so direct sources come first — their data is richer
  const DIRECT_SOURCES = ["SECI", "NTPC", "uktenders", "GeM", "GUVNL", "MSEDCL", "IREDA", "POWERGRID", "HPPCL", "eProcure"];
  tenders.sort((a, b) => {
    const aScore = DIRECT_SOURCES.includes(a.sources?.[0]) ? 0 : 1;
    const bScore = DIRECT_SOURCES.includes(b.sources?.[0]) ? 0 : 1;
    return aScore - bScore;
  });

  const result = []; // final deduplicated list

  for (const tender of tenders) {
    let merged = false;

    for (let i = 0; i < result.length; i++) {
      const existing = result[i];

      // Layer 1: exact NIT match
      if (tender.nitNumber === existing.nitNumber) {
        result[i] = mergeTenders(existing, tender);
        merged = true;
        break;
      }

      // Layer 2: fuzzy match on capacity + deadline
      if (isFuzzyMatch(existing, tender)) {
        result[i] = mergeTenders(existing, tender);
        merged = true;
        break;
      }

      // Layer 3: title similarity
      if (isTitleMatch(existing, tender)) {
        result[i] = mergeTenders(existing, tender);
        merged = true;
        break;
      }
    }

    if (!merged) {
      result.push(tender);
    }
  }

  const deduped = tenders.length - result.length;
  if (deduped > 0) {
    console.log(
      `[Dedup] Merged ${deduped} duplicate(s), ${result.length} unique tenders remain`
    );
  }

  return result;
}

/**
 * Fuzzy match: same powerMW + energyMWh + bidDeadline (same day).
 * Both must have powerMW and energyMWh to match.
 */
function isFuzzyMatch(a, b) {
  // Both must have capacity data
  if (!a.powerMW || !b.powerMW) return false;
  if (a.powerMW !== b.powerMW) return false;

  // If both have energyMWh, they must match
  if (a.energyMWh && b.energyMWh && a.energyMWh !== b.energyMWh) return false;

  // If both have deadlines, they must be the same day
  const aDate = getDateStr(a.bidDeadline);
  const bDate = getDateStr(b.bidDeadline);
  if (aDate && bDate && aDate !== bDate) return false;

  // If capacity matches and dates match (or one is missing), it's a match
  return true;
}

/**
 * Title similarity match: if >60% of significant words overlap.
 * Catches cases like "500 MW/1000 MWh Standalone BESS Punjab" from two sources.
 */
function isTitleMatch(a, b) {
  const aWords = getSignificantWords(a.title);
  const bWords = getSignificantWords(b.title);

  if (aWords.size < 3 || bWords.size < 3) return false;

  // Count overlap
  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap++;
  }

  const minSize = Math.min(aWords.size, bWords.size);
  const similarity = overlap / minSize;

  return similarity >= 0.6 && overlap >= 4;
}

/**
 * Extract significant words from a title (ignore common filler words).
 */
function getSignificantWords(title) {
  if (!title) return new Set();

  const STOP_WORDS = new Set([
    "the", "of", "for", "and", "in", "at", "to", "a", "an", "by", "on",
    "with", "from", "under", "tender", "tenders", "bid", "bids", "corrigendum",
    "implementation", "setting", "up", "supply", "design", "construction",
    "erection", "testing", "commissioning", "operation", "maintenance",
    "project", "projects", "system", "systems", "based", "competitive",
    "bidding", "mechanism", "selection", "eligible", "bidders",
    "rfs", "request", "notice", "nit", "eoi", "expression", "interest",
  ]);

  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Extract YYYY-MM-DD string from a deadline value.
 */
function getDateStr(deadline) {
  if (!deadline) return null;

  // Firestore Timestamp
  if (typeof deadline.toDate === "function") {
    return deadline.toDate().toISOString().slice(0, 10);
  }

  // String date — try to parse
  if (typeof deadline === "string") {
    // "Apr 20, 2026" or "20-Apr-2026" or "20/04/2026"
    const d = new Date(deadline);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

    // DD-MM-YYYY or DD/MM/YYYY
    const dmy = deadline.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) {
      const d2 = new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
      if (!isNaN(d2.getTime())) return d2.toISOString().slice(0, 10);
    }
  }

  return null;
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

  // Fields to merge — prefer non-null over null
  const fields = [
    "title", "category", "tenderMode", "authority", "authorityType",
    "state", "location", "powerMW", "energyMWh", "durationHours",
    "connectivityType", "emdAmount", "emdUnit", "biddingStructure",
    "bidDeadline", "emdDeadline", "preBidDate", "techBidOpeningDate",
    "financialBidOpeningDate", "bespaSigning", "documentLink",
    "documents", "preBidLink", "sourceUrl",
    "minimumBidSize", "maxAllocationPerBidder", "gridConnected",
    "roundTripEfficiency", "minimumAnnualAvailability", "dailyCycles",
    "financialClosure", "scodMonths", "gracePeriod",
    "tenderProcessingFee", "tenderDocumentFee", "vgfAmount",
    "pbgAmount", "successCharges", "paymentSecurityFund",
    "portalRegistrationFee", "totalCost",
  ];

  for (const field of fields) {
    if (merged[field] == null && incoming[field] != null) {
      merged[field] = incoming[field];
    }
  }

  // Prefer specific authority over generic aggregator labels
  const GENERIC_AUTHORITIES = ["TenderDetail", "eProcure", "GeM", "Boards / Undertakings / PSU", "Government Departments", "Local Bodies", "Private Organizations", "Statutory Bodies & Commissions/Committees"];
  if (GENERIC_AUTHORITIES.includes(merged.authority) && !GENERIC_AUTHORITIES.includes(incoming.authority) && incoming.authority) {
    merged.authority = incoming.authority;
    merged.authorityType = incoming.authorityType;
  }

  // Merge documents arrays
  if (incoming.documents && Array.isArray(incoming.documents)) {
    const existingDocs = merged.documents || [];
    const allDocs = [...existingDocs];
    for (const doc of incoming.documents) {
      if (!allDocs.some((d) => d.url === doc.url)) {
        allDocs.push(doc);
      }
    }
    if (allDocs.length > 0) merged.documents = allDocs;
  }

  // Recompute derived fields
  if (merged.powerMW && merged.energyMWh && !merged.durationHours) {
    merged.durationHours = Math.round((merged.energyMWh / merged.powerMW) * 100) / 100;
  }

  // VGF: true if either source says true
  merged.vgfEligible = existing.vgfEligible || incoming.vgfEligible;

  return merged;
}
