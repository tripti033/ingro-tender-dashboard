/**
 * verification.js — the manual-review flag carried on every tender.
 *
 * Nothing that writes tender data is trusted on its own: the scrapers guess
 * from listing pages and the local LLM guesses from PDFs, and both are wrong
 * often enough that a human has to sign off. So every automated write marks the
 * tender `unverified`, and it stays that way until someone in the team console
 * checks it and marks it `verified`.
 *
 * Re-flagging is deliberately field-aware. When an automated write changes a
 * tender that was already verified, we record WHICH fields moved — so the
 * reviewer re-checks just those instead of re-reading the whole notice.
 *
 * This is internal quality control only. The public site shows every tender
 * regardless of status, and these fields are deliberately NOT in its export
 * whitelist — publishing "we have not checked this one" is a signal worth
 * keeping internal. To gate the public site later, add `verificationStatus` to
 * PUBLIC_FIELDS in ingro-tenders-public/src/lib/tender-mapper.mjs and filter on
 * it in getAllTenders().
 */

export const UNVERIFIED = "unverified";
export const VERIFIED = "verified";

/**
 * Verification fields for a brand-new tender. No pending-field list: nothing
 * has ever been checked, so the whole record needs reading.
 */
export function newTenderVerification(now) {
  return {
    verificationStatus: UNVERIFIED,
    verificationReason: "new",
    verificationPendingFields: [],
    verificationFlaggedAt: now,
    verifiedBy: null,
    verifiedAt: null,
    verificationNote: "",
  };
}

/**
 * Verification fields for an existing tender an automated write just changed.
 *
 * @param existing       the current Firestore document data
 * @param changedFields  field names this write is actually modifying
 * @param now            Timestamp.now()
 * @param source         what made the change, e.g. "scraper" | "llm-review"
 * @returns a patch to merge into the update, or null when nothing needs saying
 */
export function reflagVerification(existing, changedFields, now, source) {
  const changed = (changedFields || []).filter(
    (f) => f && !f.startsWith("verification") && !IGNORED_FIELDS.has(f),
  );
  if (changed.length === 0) return null;

  // A tender that was signed off starts a fresh pending list; one still in the
  // queue accumulates, so nothing that moved since the last review is lost.
  const wasVerified = existing?.verificationStatus === VERIFIED;
  const previous = wasVerified ? [] : existing?.verificationPendingFields || [];
  const pending = Array.from(new Set([...previous, ...changed])).sort();

  return {
    verificationStatus: UNVERIFIED,
    verificationReason: "updated",
    verificationPendingFields: pending,
    verificationFlaggedAt: now,
    verificationFlaggedBy: source,
    // verifiedBy/verifiedAt are intentionally left in place: they record who
    // last signed the tender off, which is useful context for the re-check.
  };
}

/**
 * Bookkeeping that changes on every scrape and says nothing about whether the
 * tender's facts are right. Re-flagging on these would keep the queue
 * permanently full and train everyone to ignore it.
 */
const IGNORED_FIELDS = new Set([
  "lastUpdatedAt",
  "daysLeft",
  "sources",
  "firstSeenAt",
  "llmExtractionFailed",
  "llmExtractionAttemptedAt",
  "pdfTextOverride",
  "pdfTextOverrideAt",
  "pdfTextOverrideBy",
  "corrigendumCount",
  "flags",
  "notes",
  "readBy",
  "assignedTo",
]);

/** Field names in an update object that count as a real data change. */
export function meaningfulChanges(updates) {
  return Object.keys(updates || {}).filter(
    (f) => !IGNORED_FIELDS.has(f) && !f.startsWith("verification") && f !== "verifiedBy" && f !== "verifiedAt",
  );
}
