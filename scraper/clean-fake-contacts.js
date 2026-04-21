/**
 * One-shot cleanup: null out obviously-fake contact fields in existing
 * Firestore tenders. Runs purely on pattern-matching — no PDF re-fetch.
 *
 * A value is considered fake if it matches any of:
 *   contactEmail   — placeholder prefix (abc/test/info/example/contact/
 *                    admin/dummy/xyz/foo/bar) or invalid format
 *   contactPhone   — all-zeros/all-nines/1234567890, or not 8-15 digits
 *   contactPerson  — generic placeholders like "John Doe", "Contact Person",
 *                    "The Undersigned", "N/A"
 *
 * Usage:
 *   node scraper/clean-fake-contacts.js           # apply fixes
 *   node scraper/clean-fake-contacts.js --dry     # preview only
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, updateDoc, Timestamp,
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

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const EMAIL_PLACEHOLDER = /^(abc|test|example|contact|info|admin|dummy|xyz|foo|bar|user|someone|name|email|your)@/i;
const PHONE_FAKE = /^(1234567890|0987654321|0000000000|9999999999|1111111111)$/;
const PERSON_PLACEHOLDER = /^(john\s+doe|jane\s+doe|mr\.?\s+x|contact\s+person|the\s+undersigned|n\.?a\.?|tbd|name|undersigned|\-+)$/i;

function isFakeEmail(e) {
  if (!e) return false;
  const s = String(e).trim();
  return !EMAIL_RE.test(s) || EMAIL_PLACEHOLDER.test(s);
}

function isFakePhone(p) {
  if (!p) return false;
  const digits = String(p).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return true;
  if (PHONE_FAKE.test(digits)) return true;
  if (/^(\d)\1+$/.test(digits)) return true; // all same digit
  return false;
}

function isFakePerson(n) {
  if (!n) return false;
  const s = String(n).trim();
  if (s.length < 3) return true;
  return PERSON_PLACEHOLDER.test(s);
}

console.log(`Loading tenders...${dryRun ? " (DRY RUN — no writes)" : ""}`);
const snap = await getDocs(collection(db, "tenders"));
console.log(`Scanning ${snap.size} tenders\n`);

let cleared = 0, emailN = 0, phoneN = 0, personN = 0;

for (const d of snap.docs) {
  const t = d.data();
  const updates = {};

  if (isFakeEmail(t.contactEmail)) {
    console.log(`  ${d.id}: email "${t.contactEmail}" → null`);
    updates.contactEmail = null;
    emailN++;
  }
  if (isFakePhone(t.contactPhone)) {
    console.log(`  ${d.id}: phone "${t.contactPhone}" → null`);
    updates.contactPhone = null;
    phoneN++;
  }
  if (isFakePerson(t.contactPerson)) {
    console.log(`  ${d.id}: person "${t.contactPerson}" → null`);
    updates.contactPerson = null;
    personN++;
  }

  if (Object.keys(updates).length > 0) {
    cleared++;
    if (!dryRun) {
      updates.lastUpdatedAt = Timestamp.now();
      await updateDoc(d.ref, updates);
    }
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Tenders touched: ${cleared}`);
console.log(`  contactEmail cleared:  ${emailN}`);
console.log(`  contactPhone cleared:  ${phoneN}`);
console.log(`  contactPerson cleared: ${personN}`);
if (dryRun) console.log(`(dry-run — nothing was written)`);
process.exit(0);
