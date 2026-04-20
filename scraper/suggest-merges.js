/**
 * Company Merge Suggester
 *
 * Groups companies by a normalized name key (stripping legal suffixes,
 * filler words, punctuation) and writes each multi-member group as a
 * merge suggestion to Firestore for human review on /companies/merges.
 *
 * Usage:
 *   node scraper/suggest-merges.js           # Generate suggestions
 *   node scraper/suggest-merges.js --clear   # Delete all pending suggestions first
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, setDoc, deleteDoc, query, where, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const authFb = getAuth(app);
await signInWithEmailAndPassword(authFb, process.env.FIREBASE_SCRAPER_EMAIL, process.env.FIREBASE_SCRAPER_PASSWORD);
const db = getFirestore(app);

// Words stripped during normalization. Order matters: strip multi-word phrases first.
const STRIP_PHRASES = [
  "private limited", "public limited", "pvt ltd", "pvt. ltd.", "pvt. ltd", "pvt ltd.",
  "p ltd", "(p) ltd", "pvt", "ltd", "llp", "inc", "corp", "corporation", "company",
  "co.", " co ", "india", "indian", "bharat", "limited",
];
const STRIP_WORDS = [
  "projects", "project", "works", "work", "engineering", "engineers",
  "industries", "industrial", "international", "enterprises", "enterprise",
  "group", "holdings", "holding", "solutions", "services",
];

function normalize(name) {
  let s = ` ${name.toLowerCase().trim()} `;
  // Replace punctuation with space
  s = s.replace(/[^a-z0-9]+/g, " ");
  // Strip legal/filler phrases and words — loop until stable
  for (let i = 0; i < 3; i++) {
    for (const p of STRIP_PHRASES) s = s.replace(new RegExp(` ${p} `, "g"), " ");
    for (const w of STRIP_WORDS) s = s.replace(new RegExp(` ${w} `, "g"), " ");
    s = s.replace(/\s+/g, " ");
  }
  return s.trim();
}

const args = process.argv.slice(2);

if (args.includes("--clear")) {
  console.log("Clearing pending suggestions...");
  const snap = await getDocs(query(collection(db, "merge_suggestions"), where("status", "==", "pending")));
  let n = 0;
  for (const d of snap.docs) { await deleteDoc(d.ref); n++; }
  console.log(`Deleted ${n} pending suggestions`);
}

const compSnap = await getDocs(collection(db, "companies"));
const companies = compSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
console.log(`Loaded ${companies.length} companies`);

// Group by normalized key
const groups = new Map();
for (const c of companies) {
  const key = normalize(c.name || "");
  if (!key || key.length < 2) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}

const duplicateGroups = [...groups.entries()].filter(([, members]) => members.length > 1);
console.log(`Found ${duplicateGroups.length} duplicate groups covering ${duplicateGroups.reduce((s, [, m]) => s + m.length, 0)} companies`);

// Load existing pending suggestions so we don't duplicate
const existingSnap = await getDocs(query(collection(db, "merge_suggestions"), where("status", "==", "pending")));
const existingKeys = new Set(existingSnap.docs.map((d) => d.data().normalizedKey));

let created = 0;
for (const [key, members] of duplicateGroups) {
  if (existingKeys.has(key)) { console.log(`  skip (exists): ${key}`); continue; }

  // Pick canonical: most bidsWon, then longest name (usually most complete), then alphabetic
  const sorted = [...members].sort((a, b) => {
    const won = (b.bidsWon || 0) - (a.bidsWon || 0);
    if (won !== 0) return won;
    const lost = (b.bidsLost || 0) - (a.bidsLost || 0);
    if (lost !== 0) return lost;
    return (b.name || "").length - (a.name || "").length;
  });
  const canonical = sorted[0];

  const suggestionId = `sug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(db, "merge_suggestions", suggestionId), {
    normalizedKey: key,
    companyIds: members.map((m) => m.id),
    companies: members.map((m) => ({
      id: m.id,
      name: m.name || "",
      bidsWon: m.bidsWon || 0,
      bidsLost: m.bidsLost || 0,
      totalCapacityMWh: m.totalCapacityMWh || 0,
    })),
    suggestedCanonicalId: canonical.id,
    status: "pending",
    createdAt: Timestamp.now(),
  });
  created++;
  console.log(`  + ${members.map((m) => m.name).join(" / ")}  → canonical: ${canonical.name}`);
}

console.log(`\nDone. Created ${created} new suggestions. Review at /companies/merges`);
process.exit(0);
