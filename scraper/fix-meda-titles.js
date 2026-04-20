/**
 * One-time fix: rewrite MEDA tender titles from Marathi to English.
 *
 * Older MEDA rows were scraped before the English culture-switch cookie
 * was wired into the MEDA scraper, so their `title` field is Marathi.
 * This script refetches MEDA in English and overwrites the title on any
 * existing tender whose NIT matches.
 *
 * Usage:
 *   node scraper/fix-meda-titles.js
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { scrapeMeda } from "./sources/meda.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

async function translateWithGemini(marathi) {
  if (!GEMINI_API_KEY) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Translate this Marathi tender description to English. Keep NIT numbers, capacities, and all technical terms exactly as-is. Respond with ONLY the English translation, no quotes, no preface.\n\nMarathi:\n${marathi}`,
            }],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 800 },
        }),
      },
    );
    if (!resp.ok) { console.log(`  [Gemini] error ${resp.status}`); return null; }
    const data = await resp.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim() || null;
  } catch (e) {
    console.log(`  [Gemini] ${e.message}`);
    return null;
  }
}

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

function isMarathi(str) {
  if (!str) return false;
  let marathiChars = 0;
  for (const c of str) {
    if (c >= "\u0900" && c <= "\u097F") marathiChars++;
    if (marathiChars >= 5) return true;
  }
  return false;
}

console.log("Fetching MEDA in English...");
const tenders = await scrapeMeda();
console.log(`Got ${tenders.length} MEDA tenders from scraper`);

let updated = 0, skipped = 0, missing = 0;
for (const t of tenders) {
  const ref = doc(db, "tenders", t.nitNumber);
  const snap = await getDoc(ref);
  if (!snap.exists()) { missing++; console.log(`  - ${t.nitNumber}: not in Firestore`); continue; }
  const existing = snap.data();
  if (!isMarathi(existing.title)) {
    skipped++;
    console.log(`  ✓ ${t.nitNumber}: title already English, skip`);
    continue;
  }
  await updateDoc(ref, { title: t.title, lastUpdatedAt: Timestamp.now() });
  updated++;
  console.log(`  → ${t.nitNumber}: updated to "${t.title.slice(0, 80)}..."`);
}

console.log(`\nPass 1 (scrape): Updated ${updated} | Skipped ${skipped} | Not on live page ${missing}`);

// Pass 2 — orphaned MEDA tenders (Marathi titles, not on live page)
// Translate them with Gemini since we can't re-scrape them.
console.log(`\nPass 2: scanning Firestore for Marathi MEDA titles...`);
const medaSnap = await getDocs(query(collection(db, "tenders"), where("authority", "==", "MEDA")));
let translated = 0, pass2Skip = 0;
for (const d of medaSnap.docs) {
  const t = d.data();
  if (!isMarathi(t.title)) { pass2Skip++; continue; }
  console.log(`  Translating ${d.id}...`);
  const english = await translateWithGemini(t.title);
  if (!english) { console.log(`    → failed, skipping`); continue; }
  await updateDoc(d.ref, { title: english.slice(0, 500), lastUpdatedAt: Timestamp.now() });
  translated++;
  console.log(`    → "${english.slice(0, 80)}..."`);
  await new Promise((r) => setTimeout(r, 3000)); // be gentle on free-tier quota
}

console.log(`\nPass 2 (Gemini): Translated ${translated} | Already English ${pass2Skip}`);
console.log(`\nAll done.`);
process.exit(0);
