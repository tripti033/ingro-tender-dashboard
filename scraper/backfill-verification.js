/**
 * backfill-verification.js — put every existing tender into the review queue.
 *
 *   node scraper/backfill-verification.js --dry     # show what would change
 *   node scraper/backfill-verification.js           # apply
 *
 * Run ONCE when the verification feature ships. Everything already in Firestore
 * was written by a scraper or the LLM with nobody checking it, so it all starts
 * `unverified`. From then on the scrapers maintain the flag themselves.
 *
 * Idempotent: tenders that already carry a verificationStatus are left alone,
 * so re-running can never wipe someone's sign-off.
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { UNVERIFIED } from "./verification.js";

const DRY = process.argv.includes("--dry");

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});

const cred = await signInWithEmailAndPassword(
  getAuth(app),
  process.env.FIREBASE_SCRAPER_EMAIL,
  process.env.FIREBASE_SCRAPER_PASSWORD,
);
console.log(`[backfill] signed in as ${cred.user.email}${DRY ? "  (DRY RUN)" : ""}`);

const db = getFirestore(app);
const snap = await getDocs(collection(db, "tenders"));
console.log(`[backfill] ${snap.size} tenders in the collection`);

const now = Timestamp.now();
let flagged = 0;
let alreadySet = 0;
let failed = 0;

for (const d of snap.docs) {
  const data = d.data();
  if (data.verificationStatus) {
    alreadySet++;
    continue;
  }
  if (DRY) {
    flagged++;
    if (flagged <= 5) console.log(`  would flag: ${d.id}`);
    continue;
  }
  try {
    await updateDoc(doc(db, "tenders", d.id), {
      verificationStatus: UNVERIFIED,
      verificationReason: "backfill",
      verificationPendingFields: [],
      verificationFlaggedAt: now,
      verificationFlaggedBy: "backfill",
      verifiedBy: null,
      verifiedAt: null,
      verificationNote: "",
    });
    flagged++;
  } catch (err) {
    failed++;
    console.error(`  FAILED ${d.id}: ${err.message}`);
  }
}

console.log(
  `[backfill] ${DRY ? "would flag" : "flagged"}: ${flagged}, ` +
    `already had a status: ${alreadySet}, failed: ${failed}`,
);
if (DRY) console.log("[backfill] dry run — nothing written. Re-run without --dry to apply.");
process.exit(failed > 0 ? 1 : 0);
