/**
 * One-shot: delete corrigenda whose parent tender isn't in the database.
 *
 * A corrigendum without its parent is useless — the BD team can't see what
 * the amendment is relative to, and every "View parent" link dead-ends.
 *
 * The next scraper run may recreate the parent and re-link automatically,
 * so re-running this after a scrape is safe (it only touches orphans).
 *
 * Usage:
 *   node scraper/remove-orphan-corrigenda.js --dry   # preview
 *   node scraper/remove-orphan-corrigenda.js         # apply
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, deleteDoc,
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

console.log(`Scanning tenders...${dryRun ? " (DRY RUN)" : ""}`);
const snap = await getDocs(collection(db, "tenders"));
const ids = new Set(snap.docs.map((d) => d.id));

let deleted = 0, subDocs = 0, kept = 0, missingParentRef = 0;

for (const d of snap.docs) {
  const t = d.data();
  if (!t.isCorrigendum) continue;

  // Corrigendum with no parent reference at all — also treated as orphan
  if (!t.corrigendumOf) {
    missingParentRef++;
    console.log(`  NO-PARENT  ${d.id}  "${(t.title || "").slice(0, 60)}"`);
    if (!dryRun) {
      subDocs += (await deleteSubcollection(d.ref, "checklist"))
        + (await deleteSubcollection(d.ref, "editHistory"));
      await deleteDoc(d.ref);
    }
    deleted++;
    continue;
  }

  if (!ids.has(t.corrigendumOf)) {
    console.log(`  ORPHAN     ${d.id}  ->  parent "${t.corrigendumOf}" missing`);
    if (!dryRun) {
      subDocs += (await deleteSubcollection(d.ref, "checklist"))
        + (await deleteSubcollection(d.ref, "editHistory"));
      await deleteDoc(d.ref);
    }
    deleted++;
  } else {
    kept++;
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Kept ${kept} linked corrigenda`);
console.log(`Deleted ${deleted} orphan corrigenda (${missingParentRef} had no parent ref at all, + ${subDocs} subcollection docs)`);
if (dryRun) console.log(`(dry-run — nothing was written)`);
process.exit(0);
