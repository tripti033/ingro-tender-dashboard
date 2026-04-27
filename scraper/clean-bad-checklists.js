/**
 * One-shot: aggressive cleanup of LLM-generated checklist items that
 * aren't actually documents-to-submit. Pre-demo polish.
 *
 * Rejects items matching any of these:
 *   - Hindi/Devanagari fragments (>20% Devanagari chars)
 *   - "Bid Title: ..." (description of the tender, not a doc)
 *   - "Please refer / refer to ..."
 *   - "w.e.f.", "uktenders.gov.in", "tenderwizard"
 *   - Dates / availability text ("Date for availability", "Last Date", "तिथि")
 *   - Tender numbering ("Bid Identification Nos", "निविदा सं")
 *   - Procedural intros ("GENERAL", "SPECIAL INSTRUCTIONS",
 *     "Internet Connectivity", "RESTRICTION ON PROCUREMENT", "Note:")
 *   - Footer slogans ("Avoid wasteful")
 *   - Truncated fragments (length < 15 or trailing partial-word)
 *   - Generic "Tender Document(s)" / "Description Existing Revised"
 *
 * Usage:
 *   node scraper/clean-bad-checklists.js --dry
 *   node scraper/clean-bad-checklists.js
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run");

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
await signInWithEmailAndPassword(
  getAuth(app),
  process.env.FIREBASE_SCRAPER_EMAIL,
  process.env.FIREBASE_SCRAPER_PASSWORD,
);
const db = getFirestore(app);

const REJECT_PATTERNS = [
  // Hindi/Devanagari (already covered by ratio check below, but explicit too)
  // Bid title / description metadata
  /^bid\s+title\s*[:\-]/i,
  /^description\s+existing/i,
  /^tender\s+document\(s\)\s*$/i,
  // Refer / w.e.f. / portal URLs
  /please\s+refer\s+to/i,
  /\brefer\s+to\s+the\s+above/i,
  /\bw\.e\.f\./i,
  /uktenders\.gov\.in/i,
  /tenderwizard/i,
  /e-procurement\s+portal/i,
  /https?:\/\//i,
  // Date / availability text
  /date\s+for\s+availability/i,
  /last\s+date.*receipt/i,
  /availability\s+of\s+bid\s+document/i,
  // Tender numbering
  /bid\s+identification\s+nos?\.?:/i,
  /^[\(\s]*i+\s*[\)]\s*t-\d/i, // "(i) T-01..."
  /निविदा\s*सं/,
  /निविदा\s*प्रा/,
  /निविदा\s*की/,
  // Procedural intros
  /^general\s/i,
  /^special\s+instructions/i,
  /^internet\s+connectivity/i,
  /^restriction\s+on\s+procurement/i,
  /^note\s*:/i,
  /^declaration\s*$/i,
  /^bidders\s+are\s+advised/i,
  /^h\)\s+bidders/i,
  /^e-tendering\s+is\s+a/i,
  /annexure\s+to\s+format/i,
  // Footer slogans
  /avoid\s+wasteful/i,
  // Hindi work-name patterns
  /^कार्य\s*का\s*नाम/,
  /वेबसाइट\s*पर\s*निविदा/,
  /वैबसाइट\s*पर\s*निविदा/,
  /विस्तृत\s*जानकारी/,
  // Online/Cover description fragments
  /^online\s+tariff\s+based/i,
  /^the\s+bidders?\s+shall\s+submit/i,
  /^the\s+solar\s+pv\s+modules/i,
  /^documents\s+as\s+mentioned\s+below/i,
  /^in\s+case\s+of\s+a\s+bidding\s+consortium/i,
];

function isBad(item) {
  const doc = (item.document || "").trim();
  if (!doc) return "empty";
  if (doc.length < 15) return "too short";

  // Devanagari ratio check
  const dev = (doc.match(/[ऀ-ॿ]/g) || []).length;
  if (dev / doc.length > 0.20) return "Hindi fragment";

  for (const re of REJECT_PATTERNS) {
    if (re.test(doc)) return `pattern: ${re.toString().slice(0, 60)}`;
  }

  // Truncated (ends with very short partial word, no period)
  const lastWord = doc.trim().split(/\s+/).pop() || "";
  if (lastWord.length === 1 || (lastWord.length === 2 && /^(of|or|to|in|at|on|by)$/i.test(lastWord))) {
    return "truncated";
  }

  return null;
}

console.log(`Scanning checklists...${dryRun ? " (DRY RUN)" : ""}\n`);
const tenders = await getDocs(collection(db, "tenders"));
let scanned = 0, deleted = 0, kept = 0;
const tenderHits = {};

for (const t of tenders.docs) {
  const cl = await getDocs(collection(t.ref, "checklist"));
  if (cl.empty) continue;
  for (const c of cl.docs) {
    scanned++;
    const reason = isBad(c.data());
    if (reason) {
      console.log(`  ✗ ${t.id.slice(0, 32).padEnd(32)} | ${reason.slice(0, 30).padEnd(30)} | ${(c.data().document || "").slice(0, 70)}`);
      if (!dryRun) await deleteDoc(c.ref);
      deleted++;
      tenderHits[t.id] = (tenderHits[t.id] || 0) + 1;
    } else {
      kept++;
    }
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Scanned: ${scanned} | Kept: ${kept} | Deleted: ${deleted}`);
console.log(`Tenders touched: ${Object.keys(tenderHits).length}`);
if (dryRun) console.log(`(dry-run — nothing was written)`);
process.exit(0);
