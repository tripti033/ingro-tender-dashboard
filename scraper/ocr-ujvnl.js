/**
 * OCR fallback for UJVNL (and any other) tender PDFs whose text extraction
 * comes back as gibberish. UJVNL uses Microsoft-Word non-Unicode Devanagari
 * fonts that render fine visually but produce garbage when text-mined.
 *
 * Approach:
 *  1. Download the PDF
 *  2. Send it to Gemini Vision as inline_data — Gemini reads PDFs as
 *     images and transcribes the readable text. (Transcription only,
 *     no analysis — that's a separate Ollama step.)
 *  3. Stash the clean text on the tender as `pdfTextOverride` so future
 *     extract-checklist / llm-review runs use this instead of pdf-parse.
 *
 * Usage:
 *   node scraper/ocr-ujvnl.js                 # all UJVNL tenders
 *   node scraper/ocr-ujvnl.js T-04-EE...      # one tender
 *   node scraper/ocr-ujvnl.js --force         # re-OCR even if override exists
 */
import "dotenv/config";
import axios from "axios";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, getDoc, updateDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const targetNit = args.find((a) => !a.startsWith("--")) || null;

// ── Firebase ──
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

async function downloadPdf(url) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      responseType: "arraybuffer",
      timeout: 60000,
      maxContentLength: 18 * 1024 * 1024, // Gemini inline-data cap
    });
    return Buffer.from(resp.data);
  } catch (err) {
    console.log(`  [PDF] download failed: ${err.message}`);
    return null;
  }
}

async function ocrWithGemini(pdfBuffer, attempt = 1) {
  const base64 = pdfBuffer.toString("base64");
  const prompt = `Transcribe ALL the readable text from this Indian tender / RfP document. The PDF was exported from MS Word using non-Unicode Devanagari fonts, so plain text extraction returns gibberish — but the document IS in English when viewed. Read what you actually see in the rendered pages.

Output rules:
  - Plain text only. Preserve paragraph structure with blank lines.
  - Keep tables roughly aligned (use spaces, not tabs).
  - Do NOT summarise, do NOT analyse, do NOT add commentary.
  - Do NOT skip sections — include the entire document, header to footer.
  - If a section is truly unreadable, write [unreadable] inline; don't make anything up.`;

  const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: "application/pdf", data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 16000 },
    }),
  });

  // 503 = "model overloaded / temporary". Retry up to 2 times with backoff.
  if (resp.status === 503 && attempt <= 2) {
    const wait = 15 * attempt;
    console.log(`  [Gemini] 503, retrying in ${wait}s...`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return ocrWithGemini(pdfBuffer, attempt + 1);
  }

  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Gemini] ${resp.status}: ${err.slice(0, 300)}`);
    return null;
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text || null;
}

// ── Load candidates ──
async function loadCandidates() {
  if (targetNit) {
    const snap = await getDoc(doc(db, "tenders", targetNit));
    if (!snap.exists()) { console.log(`Not found: ${targetNit}`); return []; }
    return [{ nitNumber: targetNit, ...snap.data() }];
  }
  // Default: any tender with documentLink + UJVNL authority + no override
  const snap = await getDocs(collection(db, "tenders"));
  return snap.docs
    .map((d) => ({ nitNumber: d.id, ...d.data() }))
    .filter((t) => t.authority === "UJVNL" && t.documentLink && (force || !t.pdfTextOverride));
}

const candidates = await loadCandidates();
console.log(`${candidates.length} tender(s) to OCR\n`);

let ok = 0, fail = 0;
for (let i = 0; i < candidates.length; i++) {
  const t = candidates[i];
  console.log(`[${i + 1}/${candidates.length}] ${t.nitNumber}`);
  console.log(`  ${(t.title || "").slice(0, 100)}`);
  console.log(`  PDF: ${t.documentLink}`);

  const pdf = await downloadPdf(t.documentLink);
  if (!pdf) { fail++; continue; }
  console.log(`  Downloaded ${(pdf.length / 1024).toFixed(0)} KB; sending to Gemini Vision...`);

  const text = await ocrWithGemini(pdf);
  if (!text || text.length < 100) {
    console.log(`  → Gemini returned no usable text`);
    fail++;
    continue;
  }
  console.log(`  → ${text.length.toLocaleString()} chars OCRed. Sample: ${text.slice(0, 150).replace(/\s+/g, " ")}…`);

  await updateDoc(doc(db, "tenders", t.nitNumber), {
    pdfTextOverride: text.slice(0, 100000), // Firestore field limit guard
    pdfTextOverrideAt: Timestamp.now(),
    pdfTextOverrideBy: "gemini-vision-ocr",
    lastUpdatedAt: Timestamp.now(),
  });
  ok++;

  // Free-tier gentle rate-limit
  await new Promise((r) => setTimeout(r, 4000));
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Done. OCRed: ${ok} | Failed: ${fail}`);
process.exit(0);
