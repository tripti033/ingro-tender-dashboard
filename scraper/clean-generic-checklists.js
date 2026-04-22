/**
 * One-shot: delete checklist items that were echoed verbatim from the
 * previous extraction prompt (before the prompt was tightened). Those rows
 * look like "Format 6.4 / Annexure-E / page 42 — or null if not given" as
 * the reference, or "Physical DDs, EMD, stamp-paper affidavits..." as the
 * document — generic phrases that never appeared in any actual tender.
 *
 * Usage:
 *   node scraper/clean-generic-checklists.js --dry   # preview
 *   node scraper/clean-generic-checklists.js         # apply
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

const BANNED = [
  "format 6.4 / annexure-e / page 42",
  "or null if not given",
  "project-specific asks",
  "stamp-paper affidavits, hard-copy securities",
  "formats, ca certificates, financials, moa/aoa, it returns, signed annexures",
  "physical dds, emd, stamp-paper",
  "dds, emd, stamp-paper",
  "electronic technical bid — formats",
  "electronic financial bid — boq",
  "boq, tariff quote",
];

const tenders = await getDocs(collection(db, "tenders"));
let deleted = 0, scanned = 0, touchedTenders = 0;

for (const t of tenders.docs) {
  const clSnap = await getDocs(collection(t.ref, "checklist"));
  if (clSnap.empty) continue;

  let deletedForThis = 0;
  for (const c of clSnap.docs) {
    scanned++;
    const item = c.data();
    const doc = String(item.document || "").toLowerCase();
    const ref = String(item.reference || "").toLowerCase();
    const looksGeneric =
      BANNED.some((b) => doc.includes(b)) ||
      BANNED.some((b) => ref.includes(b)) ||
      ref === "format 6.4 / annexure-e / page 42 — or null if not given";

    if (looksGeneric) {
      console.log(`  ${t.id.slice(0, 30).padEnd(30)}  ✗  ${String(item.document).slice(0, 80)}`);
      if (!dryRun) await deleteDoc(c.ref);
      deleted++;
      deletedForThis++;
    }
  }
  if (deletedForThis > 0) touchedTenders++;
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Scanned: ${scanned} items across ${tenders.size} tenders`);
console.log(`Deleted: ${deleted} generic items on ${touchedTenders} tenders`);
if (dryRun) console.log(`(dry-run — nothing was written)`);
process.exit(0);
