/**
 * Extract a submission checklist from a tender's bid document using the
 * local LLM (Ollama). Runs the same pattern as llm-review.js — downloads
 * the PDF, sends the "Annexures / Submission / Supporting Documents"
 * sections to Llama, shows the extracted items for approval, writes
 * approved items into tenders/{nit}/checklist.
 *
 * Usage:
 *   node scraper/extract-checklist.js <nitNumber>    # one tender, interactive
 *   node scraper/extract-checklist.js                # all tenders missing a checklist
 *   node scraper/extract-checklist.js --all          # force rerun on every tender
 *
 * Controls per tender:
 *   y = write all extracted items
 *   n = skip this tender
 *   a = approve all remaining tenders without prompting
 *   q = quit
 */
import "dotenv/config";
import readline from "readline";
import axios from "axios";
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, collection, getDocs, addDoc, deleteDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { callLlm, isLlmAvailable } from "./llm.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// ── CLI args ──
const args = process.argv.slice(2);
const forceAll = args.includes("--all");
const targetNit = args.find((a) => !a.startsWith("--"));

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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── PDF download + extract ──
async function downloadPdfText(pdfUrl) {
  let PDFParseClass;
  try {
    const mod = await import("pdf-parse");
    PDFParseClass = mod.PDFParse;
  } catch {
    console.log("[PDF] pdf-parse not installed. Run: npm install pdf-parse");
    return null;
  }
  try {
    const resp = await axios.get(pdfUrl, {
      headers: { "User-Agent": USER_AGENT },
      responseType: "arraybuffer",
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024,
    });
    const parser = new PDFParseClass({ data: Buffer.from(resp.data) });
    await parser.load();
    const result = await parser.getText();
    parser.destroy();
    return result.text || null;
  } catch (err) {
    console.log(`[PDF] ${err.message}`);
    return null;
  }
}

// ── Chunk the PDF around checklist-related keywords ──
const CHECKLIST_KEYWORDS = [
  "annexure", "annexure-", "appendix", "format 6.", "format-6.",
  "supporting document", "supporting documents",
  "submission checklist", "checklist", "documents to be submitted",
  "list of documents", "documents required", "submission of bid",
  "covering letter", "cover-1", "cover-2", "cover-3",
  "envelope-1", "envelope-2", "envelope-3", "envelope 1", "envelope 2", "envelope 3",
  "financial bid", "technical bid",
];

function buildPromptText(pdfText) {
  const chunks = new Set();
  const lower = pdfText.toLowerCase();
  for (const kw of CHECKLIST_KEYWORDS) {
    let idx = 0;
    while ((idx = lower.indexOf(kw, idx)) !== -1) {
      const start = Math.max(0, idx - 150);
      const end = Math.min(pdfText.length, idx + 500);
      chunks.add(pdfText.slice(start, end));
      idx += kw.length;
      if (chunks.size >= 40) break;
    }
    if (chunks.size >= 40) break;
  }
  // Also include the last 3000 chars — checklists often live at the end
  const tail = pdfText.slice(Math.max(0, pdfText.length - 3000));
  const combined = [
    pdfText.slice(0, 2000),
    "\n--- KEY SECTIONS ---\n",
    ...Array.from(chunks),
    "\n--- TAIL ---\n",
    tail,
  ].join("\n");
  // Keep under ~12K chars for 3B model
  return combined.slice(0, 12000);
}

async function extractChecklistViaLlm(pdfText, tenderTitle) {
  const prompt = `Tender: "${tenderTitle}"

Read the excerpts below and build the bidder's submission checklist —
every document, certificate, DD, affidavit, format, annexure, etc.
that this specific tender asks the bidder to submit. Use the tender's
OWN wording — quote the actual phrase it uses. Never write a generic
description.

For each item, pick the bucket that matches where the tender says it
goes:
  physical / hard-copy / envelope 1  →  bucket "Envelope-1"
  electronic / technical / cover 2   →  bucket "Cover-2"
  electronic / financial / cover 3   →  bucket "Cover-3"
  anything else                       →  bucket "Custom"
If the tender uses a different label ("Packet", "Part", "Section X"),
match on meaning.

Shape of reply (ONLY JSON, no prose):
{
  "items": [
    { "bucket": "<one of the four above>",
      "document": "<the tender's own words for what to submit>",
      "reference": "<the form/annexure number or clause the tender
                     shows next to this item, or null>" }
  ]
}

IMPORTANT:
- Each "document" string MUST come from the actual tender text below.
  Do NOT write generic phrases. Do NOT paste examples from these
  instructions. If you didn't see a specific item in the text, don't
  list it.
- Each "reference" MUST be a real Format/Annexure/Clause/Page number
  that appears IN THE TEXT for that specific item. If none is shown,
  use null. Do not invent a reference.
- If the text below is truncated / doesn't contain a submission list,
  return {"items": []}. Empty is better than invented.

Text:
${pdfText}`;

  const systemPrompt = `You extract a bidder's submission checklist from Indian tender documents. Every "document" string you output MUST be a phrase that literally appears in the provided text — never a generic template phrase, never an example from the instructions. If you can't find real items, return an empty array. Respond with ONLY valid JSON.`;
  const result = await callLlm(prompt, systemPrompt);
  if (!result) return null;
  const items = Array.isArray(result.items) ? result.items : (Array.isArray(result) ? result : []);

  // Reject items that look like the model is echoing our own instructions or
  // generic template language. These exact phrases showed up repeatedly
  // across unrelated tenders when the old prompt leaked examples.
  const BANNED_FRAGMENTS = [
    "format 6.4 / annexure-e / page 42",
    "or null if not given",
    "project-specific asks",
    "unusual certifications",
    "stamp-paper affidavits, hard-copy securities, non-blacklisting certs",
    "formats, ca certificates, financials, moa/aoa, it returns, signed annexures",
    "boq, tariff quote",
    "electronic technical bid",
    "electronic financial bid",
  ];
  const pdfLower = pdfText.toLowerCase();

  return items.filter((x) => {
    if (!x || typeof x.document !== "string" || x.document.length < 3) return false;
    const docLower = x.document.toLowerCase();
    // 1) block verbatim template echoes
    if (BANNED_FRAGMENTS.some((f) => docLower.includes(f))) return false;
    // 2) require that a reasonable chunk of the claim overlaps with the PDF.
    //    Tokens of length >= 4 that actually appear in the source text.
    const tokens = docLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    if (tokens.length === 0) return false;
    const hits = tokens.filter((t) => pdfLower.includes(t)).length;
    if (hits / tokens.length < 0.5) return false; // too many invented words
    return true;
  }).map((x) => {
    // Null out obviously-copied reference strings
    if (typeof x.reference === "string") {
      const r = x.reference.toLowerCase();
      if (r.includes("or null if not given") || r.includes("format 6.4 / annexure-e")) {
        x.reference = null;
      }
    }
    return x;
  });
}

function normaliseBucket(b) {
  return ["Envelope-1", "Cover-2", "Cover-3", "Custom"].includes(b) ? b : "Custom";
}

// ── Load candidates ──
async function loadCandidates() {
  if (targetNit) {
    const snap = await getDoc(doc(db, "tenders", targetNit));
    if (!snap.exists()) {
      console.log(`Tender ${targetNit} not found`);
      return [];
    }
    return [{ nitNumber: targetNit, ...snap.data() }];
  }
  const snap = await getDocs(collection(db, "tenders"));
  const all = snap.docs.map((d) => ({ nitNumber: d.id, ...d.data() }));
  const out = [];
  for (const t of all) {
    if (!t.documentLink) continue;
    if (!forceAll) {
      const cl = await getDocs(collection(db, "tenders", t.nitNumber, "checklist"));
      if (cl.size > 0) continue;
    }
    out.push(t);
  }
  return out;
}

async function main() {
  if (!(await isLlmAvailable())) {
    console.error("Ollama is not running. Start it with: ollama serve");
    process.exit(1);
  }

  const candidates = await loadCandidates();
  console.log(`\n${candidates.length} tender(s) to process\n`);
  if (candidates.length === 0) { rl.close(); process.exit(0); }
  console.log(`${BOLD}Controls: y=write  n=skip  a=approve-all  q=quit${RESET}\n`);

  let approveAll = false;
  let written = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];
    console.log(`\n${"─".repeat(70)}`);
    console.log(`${BOLD}[${i + 1}/${candidates.length}] ${t.nitNumber}${RESET}`);
    console.log(`${DIM}${(t.title || "").slice(0, 120)}${RESET}`);
    console.log(`  Document: ${t.documentLink.slice(0, 90)}`);

    const pdfText = await downloadPdfText(t.documentLink);
    if (!pdfText) { console.log("  → Couldn't read PDF, skipping"); skipped++; continue; }

    const promptText = buildPromptText(pdfText);
    console.log(`  Sending ${promptText.length} chars to Llama...`);
    const items = await extractChecklistViaLlm(promptText, t.title || "");

    if (!items || items.length === 0) {
      console.log(`  ${YELLOW}No checklist items found in document${RESET}`);
      skipped++;
      continue;
    }

    console.log(`\n  ${GREEN}Extracted ${items.length} item(s):${RESET}`);
    const byBucket = {};
    for (const it of items) {
      const b = normaliseBucket(it.bucket);
      (byBucket[b] ||= []).push(it);
    }
    for (const [b, arr] of Object.entries(byBucket)) {
      console.log(`    ${CYAN}${b}${RESET} (${arr.length}):`);
      arr.slice(0, 8).forEach((x) => {
        const ref = x.reference ? ` ${DIM}[${x.reference}]${RESET}` : "";
        console.log(`      • ${x.document.slice(0, 90)}${ref}`);
      });
      if (arr.length > 8) console.log(`      ${DIM}+ ${arr.length - 8} more${RESET}`);
    }

    let choice;
    if (approveAll) { choice = "y"; console.log(`\n  ${GREEN}Auto-approved${RESET}`); }
    else {
      const ans = await ask(`\n  ${BOLD}Write to Firestore? [y/n/a/q]: ${RESET}`);
      choice = ans.trim().toLowerCase();
    }
    if (choice === "q") { console.log("Quitting."); break; }
    if (choice === "a") { approveAll = true; choice = "y"; console.log(`  ${GREEN}Approving remaining...${RESET}`); }

    if (choice === "y") {
      // Re-running with --all or on the same NIT? Wipe the existing checklist
      // so we don't duplicate items when the new prompt produces better output.
      const existing = await getDocs(collection(db, "tenders", t.nitNumber, "checklist"));
      if (existing.size > 0) {
        for (const d of existing.docs) await deleteDoc(d.ref);
        console.log(`  ${DIM}(cleared ${existing.size} old items first)${RESET}`);
      }
      const bucketOrder = { "Envelope-1": 10, "Cover-2": 10, "Cover-3": 10, "Custom": 10 };
      const now = Timestamp.now();
      for (const it of items) {
        const b = normaliseBucket(it.bucket);
        bucketOrder[b] += 10;
        await addDoc(collection(db, "tenders", t.nitNumber, "checklist"), {
          bucket: b,
          order: bucketOrder[b],
          document: String(it.document).slice(0, 500),
          reference: it.reference || null,
          status: "pending",
          remarks: null,
          documentLink: null,
          updatedBy: "ollama-extractor",
          updatedAt: now,
        });
      }
      console.log(`  ${GREEN}✓ Wrote ${items.length} items${RESET}`);
      written += items.length;
    } else {
      console.log(`  ${DIM}Skipped${RESET}`);
      skipped++;
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`${BOLD}Done.${RESET} Items written: ${GREEN}${written}${RESET} | Tenders skipped: ${DIM}${skipped}${RESET}`);
  rl.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); rl.close(); process.exit(1); });
