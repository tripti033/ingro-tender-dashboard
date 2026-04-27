/**
 * One-shot: delete checklist items that came from garbled-PDF extraction.
 *
 * UJVNL exports their tender PDFs from MS Word with non-Unicode Devanagari
 * fonts. The visible text reads fine, but the byte stream has no Unicode
 * mapping, so pdf-parse returns gibberish like "60 es0ok0 @150 es0ok0 vk0
 * LVS.MvyksucSVjhÅtkZHk.Mkj.kiz.kkyh(BESS)" — which the LLM dutifully
 * wrote into the checklist subcollections.
 *
 * Detection: any item whose `document` string is < 60% ASCII printable, or
 * has fewer than 3 English words of length >= 4.
 *
 * Usage:
 *   node scraper/clean-garbled-checklists.js --dry
 *   node scraper/clean-garbled-checklists.js
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

function looksGarbled(s) {
  if (!s) return false;
  const total = s.length;
  if (total < 3) return true;

  // Distinctive UJVNL Hindi-font gibberish patterns. Hits any one and it's out.
  const gibberishMarkers = /\b(es0ok0|fufonk|fryk|<djkuh|VS\.M|Vjh|ksaf|vk0|fctyh|tkudkjhbZ|izkD|kZHk|Mvyks|aVjh|Hk\.M|jkD;ks|tk\.kkyh|kdrk|cpsa|nqq:i|nqr|kksaQ|kkk|kk\.kk)/i;
  if (gibberishMarkers.test(s)) return true;

  // Devanagari script characters (BMP U+0900..U+097F) — fine if it's a small
  // amount alongside ASCII, but if more than 30% of total is Devanagari, treat
  // as garbled extraction.
  const devanagari = (s.match(/[ऀ-ॿ]/g) || []).length;
  if (devanagari / total > 0.3) return true;

  // Otherwise: if non-ASCII chars dominate AND there are basically no real
  // English words, it's garbled.
  const ascii = (s.match(/[\x20-\x7E]/g) || []).length;
  const englishLetterRuns = s.match(/[a-zA-Z]{3,}/g) || [];
  if (ascii / total < 0.4 && englishLetterRuns.length < 2) return true;

  return false;
}

console.log(`Scanning checklists...${dryRun ? " (DRY RUN)" : ""}`);
const tenders = await getDocs(collection(db, "tenders"));
let deleted = 0, scanned = 0, touched = 0;

for (const t of tenders.docs) {
  const cl = await getDocs(collection(t.ref, "checklist"));
  if (cl.empty) continue;
  let deletedHere = 0;
  for (const c of cl.docs) {
    scanned++;
    const doc = c.data().document || "";
    if (looksGarbled(doc)) {
      console.log(`  ${t.id.slice(0, 30).padEnd(30)} ✗ ${doc.slice(0, 80)}`);
      if (!dryRun) await deleteDoc(c.ref);
      deleted++;
      deletedHere++;
    }
  }
  if (deletedHere > 0) touched++;
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Scanned ${scanned} items. Deleted ${deleted} garbled items on ${touched} tenders.`);
if (dryRun) console.log("(dry-run — nothing was written)");
process.exit(0);
