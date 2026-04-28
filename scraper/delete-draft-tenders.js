/**
 * One-shot: delete a hand-picked list of DRAFT-* tenders.
 *
 * These were created from the Alerts → "Convert to draft" flow but were
 * either duplicates or no longer relevant. The user reviewed the list
 * manually; everything below gets removed.
 *
 * Usage:
 *   node scraper/delete-draft-tenders.js --dry
 *   node scraper/delete-draft-tenders.js
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, getDoc, deleteDoc,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run");

const IDS = [
  "DRAFT-1777315944511",
  "DRAFT-1777315665227",
  "DRAFT-1777315612182",
  "DRAFT-1777315581047",
  "DRAFT-1777315568225",
  "DRAFT-1777315554065",
  "DRAFT-1777315540516",
  "DRAFT-1777315525017",
  "DRAFT-1777315508103",
  "DRAFT-1777315490421",
  "DRAFT-1777315261240",
  "DRAFT-1777315232369",
  "DRAFT-1777315167012",
  "DRAFT-1777315113877",
  "DRAFT-1777315057915",
  "DRAFT-1777314670118",
  "DRAFT-1777314653231",
  "DRAFT-1777314600599",
  "DRAFT-1777314521286",
  "DRAFT-1777314319416",
  "DRAFT-1777314243696",
  "DRAFT-1777314195115",
  "DRAFT-1777314155410",
  "DRAFT-1777314020909",
];

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

async function tryDeleteSubcollection(parentRef, name) {
  try {
    const snap = await getDocs(collection(parentRef, name));
    let n = 0;
    for (const d of snap.docs) {
      if (!dryRun) await deleteDoc(d.ref);
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

console.log(`Deleting ${IDS.length} draft tenders...${dryRun ? " (DRY RUN)" : ""}\n`);

let deleted = 0, missing = 0, failed = 0, subDocs = 0;

for (const id of IDS) {
  const ref = doc(db, "tenders", id);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    console.log(`  ERR-READ   ${id}  ${e.message}`);
    failed++;
    continue;
  }
  if (!snap.exists()) {
    console.log(`  MISSING    ${id}`);
    missing++;
    continue;
  }
  const t = snap.data();
  console.log(`  DELETE     ${id}  "${(t.title || "").slice(0, 60)}"`);
  if (!dryRun) {
    subDocs += await tryDeleteSubcollection(ref, "checklist");
    subDocs += await tryDeleteSubcollection(ref, "editHistory");
    try {
      await deleteDoc(ref);
      deleted++;
    } catch (e) {
      console.log(`             FAILED: ${e.message}`);
      failed++;
      continue;
    }
  } else {
    deleted++;
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Deleted ${deleted} drafts (+ ${subDocs} subcollection docs)`);
if (missing > 0) console.log(`Skipped ${missing} that weren't in Firestore`);
if (failed > 0) console.log(`Failed ${failed} (likely permission rules)`);
if (dryRun) console.log(`(dry-run — nothing was written)`);
process.exit(failed > 0 ? 1 : 0);
