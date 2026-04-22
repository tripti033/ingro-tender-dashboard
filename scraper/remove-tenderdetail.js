/**
 * One-shot: remove the TenderDetail source from the database.
 *
 *  - Tenders whose ONLY source is "TenderDetail" → deleted outright
 *    (along with their checklist / corrigenda / editHistory subcollections).
 *  - Tenders whose sources include "TenderDetail" plus another real
 *    source (SECI / NTPC / etc.) → kept, but "TenderDetail" is stripped
 *    from the sources array so it doesn't appear on the detail page.
 *
 * Usage:
 *   node scraper/remove-tenderdetail.js --dry   # preview only
 *   node scraper/remove-tenderdetail.js         # apply
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, deleteDoc, updateDoc, Timestamp,
} from "firebase/firestore";
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

async function deleteSubcollection(parentRef, name) {
  const snap = await getDocs(collection(parentRef, name));
  let n = 0;
  for (const d of snap.docs) {
    if (!dryRun) await deleteDoc(d.ref);
    n++;
  }
  return n;
}

console.log(`Scanning tenders...${dryRun ? " (DRY RUN — no writes)" : ""}`);
const snap = await getDocs(collection(db, "tenders"));

let deleted = 0, stripped = 0, subsDeleted = 0;

for (const d of snap.docs) {
  const data = d.data();
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const hasTd = sources.includes("TenderDetail");
  if (!hasTd) continue;

  if (sources.length === 1) {
    // Only TenderDetail — delete tender + subcollections
    console.log(`  DELETE  ${d.id}  ${(data.title || "").slice(0, 60)}`);
    if (!dryRun) {
      const n = (await deleteSubcollection(d.ref, "checklist"))
        + (await deleteSubcollection(d.ref, "corrigenda"))
        + (await deleteSubcollection(d.ref, "editHistory"));
      subsDeleted += n;
      await deleteDoc(d.ref);
    }
    deleted++;
  } else {
    // Merged — strip TenderDetail from sources array
    const kept = sources.filter((s) => s !== "TenderDetail");
    console.log(`  STRIP   ${d.id}  sources: [${sources.join(", ")}] → [${kept.join(", ")}]`);
    if (!dryRun) {
      await updateDoc(d.ref, { sources: kept, lastUpdatedAt: Timestamp.now() });
    }
    stripped++;
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Deleted: ${deleted} tenders (+ ${subsDeleted} subcollection docs)`);
console.log(`Stripped: ${stripped} tenders kept source-cleaned`);
if (dryRun) console.log(`(dry-run — nothing was written)`);
process.exit(0);
