/**
 * Corrigendum change extractor (Level 3).
 *
 * For every corrigendum that hasn't been diffed yet:
 *  1. Download its PDF (if available) and extract the text
 *  2. Pull the parent tender's current field values
 *  3. Ask Gemini to diff them and return structured changes + a one-liner summary
 *  4. Store the result in tenders/<parent>/corrigenda/<child>
 *
 * Usage:
 *   node scraper/diff-corrigenda.js            # all un-extracted corrigenda
 *   node scraper/diff-corrigenda.js --retry    # also re-diff ones that already have a summary
 *   node scraper/diff-corrigenda.js <parent>   # only corrigenda of a specific parent NIT
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import axios from "axios";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const args = process.argv.slice(2);
const retry = args.includes("--retry");
const onlyParent = args.find((a) => !a.startsWith("--")) || null;

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

async function fetchPdfText(url) {
  if (!url) return null;
  try {
    const mod = await import("pdf-parse").catch(() => null);
    if (!mod) { console.log("  [PDF] pdf-parse not installed"); return null; }
    const PDFParseClass = mod.PDFParse;
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }, responseType: "arraybuffer", timeout: 30000,
    });
    const parser = new PDFParseClass({ data: Buffer.from(resp.data) });
    await parser.load();
    const result = await parser.getText();
    return (result.text || "").slice(0, 15000);
  } catch (err) {
    console.log(`  [PDF] ${err.message}`);
    return null;
  }
}

function formatParentFields(parent) {
  const ts = (v) => {
    if (!v) return null;
    try { return typeof v.toDate === "function" ? v.toDate().toISOString().slice(0, 10) : v; } catch { return v; }
  };
  return {
    title: parent.title || null,
    authority: parent.authority || null,
    bidDeadline: ts(parent.bidDeadline),
    emdDeadline: ts(parent.emdDeadline),
    preBidDate: ts(parent.preBidDate),
    techBidOpeningDate: ts(parent.techBidOpeningDate),
    financialBidOpeningDate: ts(parent.financialBidOpeningDate),
    emdAmount: parent.emdAmount ?? null,
    powerMW: parent.powerMW ?? null,
    energyMWh: parent.energyMWh ?? null,
    minimumBidSize: parent.minimumBidSize ?? null,
    maxAllocationPerBidder: parent.maxAllocationPerBidder ?? null,
  };
}

async function askGemini(parentFields, corrTitle, corrPdfText) {
  if (!GEMINI_API_KEY) return null;
  const prompt = `A BD team is tracking an Indian BESS tender and an amendment (corrigendum) has been issued. Help them see what actually changed so they don't miss an extended deadline, a revised EMD, or a new eligibility criterion.

Original tender (as currently recorded in the database):
${JSON.stringify(parentFields, null, 2)}

Corrigendum title: ${corrTitle}

Corrigendum document text (possibly truncated):
"""
${corrPdfText || "(no PDF available — rely on title only)"}
"""

Read both, figure out what's different, and return the diff a BD person would actually care about. Most corrigenda just shift dates or tweak EMD/PBG. Some expand eligibility, add formats, or re-scope the project — flag those too in the summary.

Shape of reply (ONLY JSON, no prose):
{
  "summary": "one tight sentence — what changed, in plain English",
  "changes": [
    {"field": "bidDeadline", "from": "2026-04-30", "to": "2026-05-15"},
    {"field": "emdAmount", "from": 5000000, "to": 7500000}
  ]
}

A few conventions:
  - ISO dates (YYYY-MM-DD) for date fields.
  - Plain numbers for amounts (INR, no units).
  - Only include fields that actually moved — skip unchanged fields.
  - If the corrigendum is purely procedural (a typo fix, a clarification
    that doesn't affect any tracked field), return {"summary": "...", "changes": []}.
  - Don't invent a change just to justify the JSON — it's fine to return
    an empty changes array.`;

  try {
    const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    });
    if (!resp.ok) { console.log(`  [Gemini] ${resp.status}`); return null; }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch (err) {
    console.log(`  [Gemini] ${err.message}`);
    return null;
  }
}

// ── Main loop ──

const tendersSnap = await getDocs(collection(db, "tenders"));
let totalCorr = 0, diffed = 0, skipped = 0, failed = 0;

for (const parentDoc of tendersSnap.docs) {
  if (onlyParent && parentDoc.id !== onlyParent) continue;
  const parentData = parentDoc.data();
  const corrSnap = await getDocs(collection(parentDoc.ref, "corrigenda"));
  if (corrSnap.empty) continue;

  const parentFields = formatParentFields(parentData);

  for (const c of corrSnap.docs) {
    totalCorr++;
    const cdata = c.data();
    if (cdata.extractedAt && !retry) { skipped++; continue; }

    console.log(`\n[${c.id}] parent=${parentDoc.id}`);
    console.log(`  title: ${(cdata.title || "").slice(0, 100)}`);

    const pdfText = cdata.documentLink ? await fetchPdfText(cdata.documentLink) : null;
    const result = await askGemini(parentFields, cdata.title || "", pdfText);
    if (!result) { failed++; continue; }

    const changes = Array.isArray(result.changes) ? result.changes : [];
    console.log(`  → ${changes.length} change(s): ${result.summary || ""}`);
    for (const ch of changes) console.log(`     ${ch.field}: ${ch.from} → ${ch.to}`);

    await setDoc(c.ref, {
      summary: result.summary || null,
      changes,
      extractedAt: Timestamp.now(),
    }, { merge: true });
    diffed++;

    // Gentle rate-limit for free tier
    await new Promise((r) => setTimeout(r, 4000));
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Total corrigenda: ${totalCorr} | Diffed: ${diffed} | Skipped (already done): ${skipped} | Failed: ${failed}`);
process.exit(0);
