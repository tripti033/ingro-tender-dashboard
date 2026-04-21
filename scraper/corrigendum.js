/**
 * Corrigendum detection + parent-NIT matching utilities.
 *
 * A corrigendum is an amendment to an already-published tender. Sources
 * list them either as a separate document on the parent tender, or as
 * their own row with titles/NIT variants like "<parent>-corr-1" or
 * "Corrigendum No. 2 for <parent-title>".
 *
 * We want to:
 *  - flag scraped rows as corrigenda
 *  - link each one to its parent tender's NIT so the UI can list them
 *    under the parent and so Level-3 diffing can compare fields
 */

const CORRIGENDUM_REGEX = /\b(corrigendum|corrigenda|addendum|addenda|amendment)\b/i;

export function isCorrigendum(title, nitNumber) {
  const blob = `${title || ""} ${nitNumber || ""}`;
  return CORRIGENDUM_REGEX.test(blob);
}

/**
 * Strip corrigendum suffixes/prefixes from a NIT to get the parent NIT.
 * Examples:
 *   "TENDER-123-corr-1"        → "TENDER-123"
 *   "TENDER-123-CORRIGENDUM"   → "TENDER-123"
 *   "TENDER-123-amendment-2"   → "TENDER-123"
 *   "TENDER-123 Corrigendum 1" → "TENDER-123"
 *   "CORR18"                   → null  (no parent NIT embedded)
 */
export function stripCorrigendumSuffix(nit) {
  if (!nit) return null;
  const cleaned = String(nit)
    .replace(/[\s_/-]*(corrigendum|corrigenda|addendum|addenda|amendment|corr)\s*(no\.?)?\s*[-_]?\s*\d*\s*$/i, "")
    .trim()
    .replace(/[\s_-]+$/, "");
  return cleaned && cleaned !== nit.trim() ? cleaned : null;
}

/**
 * Normalize a title so we can compare tender and corrigendum titles.
 *  - lowercased
 *  - punctuation stripped
 *  - the word "corrigendum"/"amendment"/etc. removed
 *  - numbers preserved (capacity/NIT numbers are identifying)
 */
function normalizeTitle(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(CORRIGENDUM_REGEX, " ")
    .replace(/no\.?\s*\d+/gi, " ")   // "no. 2"
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the best parent NIT from a list of known tenders for a given
 * corrigendum row. Returns null if no plausible parent is found.
 *
 * @param {object} corr  - corrigendum row { nitNumber, title, powerMW, energyMWh, authority }
 * @param {Array}  known - array of existing tenders (same shape) to search within
 */
export function findParentNit(corr, known) {
  if (!known || known.length === 0) return null;

  // 1. Exact-NIT-suffix match
  const stripped = stripCorrigendumSuffix(corr.nitNumber);
  if (stripped) {
    const hit = known.find((k) => k.nitNumber === stripped && !isCorrigendum(k.title, k.nitNumber));
    if (hit) return hit.nitNumber;
  }

  // 2. Title similarity — Jaccard on word sets, must share at least 3 words
  const corrNorm = normalizeTitle(corr.title);
  if (corrNorm.length < 8) return null;
  const corrWords = new Set(corrNorm.split(" ").filter((w) => w.length > 2));
  if (corrWords.size < 3) return null;

  let best = null;
  let bestScore = 0;
  for (const k of known) {
    if (isCorrigendum(k.title, k.nitNumber)) continue;
    if (corr.authority && k.authority && corr.authority !== k.authority) continue;

    const kNorm = normalizeTitle(k.title);
    const kWords = new Set(kNorm.split(" ").filter((w) => w.length > 2));
    if (kWords.size < 3) continue;

    let intersect = 0;
    for (const w of corrWords) if (kWords.has(w)) intersect++;
    const union = corrWords.size + kWords.size - intersect;
    if (union === 0) continue;
    const jaccard = intersect / union;

    // Capacity must also match if both rows have it (strong signal)
    if (corr.powerMW != null && k.powerMW != null && Math.abs(corr.powerMW - k.powerMW) > 0.5) continue;
    if (corr.energyMWh != null && k.energyMWh != null && Math.abs(corr.energyMWh - k.energyMWh) > 0.5) continue;

    if (jaccard > bestScore) {
      bestScore = jaccard;
      best = k;
    }
  }

  return bestScore >= 0.55 ? best.nitNumber : null;
}
