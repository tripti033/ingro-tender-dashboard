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
everything they actually have to hand over to be considered: DDs, EMD
instruments, stamp-paper affidavits, covering letter, formats, CA
certificates, balance sheets, IT returns, MoA/AoA, BoQ, and anything
else this specific tender asks for.

Tenders often organise submissions into envelopes or covers:
  - Envelope-1 = physical DDs, EMD, stamp-paper affidavits, hard-copy
    securities, non-blacklisting certs on stamp paper
  - Cover-2 = electronic technical bid — formats, CA certs, financials,
    MoA/AoA, IT returns, signed annexures
  - Cover-3 = electronic financial bid — BoQ, tariff quote
  - Custom = anything that doesn't fit cleanly (project-specific asks,
    unusual certifications, etc.)

Use the tender's own wording — every authority uses different labels
("Envelope", "Cover", "Packet", "Part", etc.). Match on meaning, not
exact wording. A careful BD person would rather have one extra item
they don't need than miss one they do — when in doubt, include it and
note the reference.

Respond with ONLY this JSON shape:
{
  "items": [
    {
      "bucket": "Envelope-1" | "Cover-2" | "Cover-3" | "Custom",
      "document": "short concrete description (< 180 chars)",
      "reference": "Format 6.4 / Annexure-E / page 42 — or null if not given"
    }
  ]
}

If the text doesn't describe any submission items at all, return {"items": []}.
Don't invent things that aren't there.

Text:
${pdfText}`;

  const systemPrompt = `You're helping a BD team prepare their bid. Extract the submission checklist from this Indian tender document. Use your judgment — tender wording varies — but stay honest: only list items that are genuinely in the text. Respond with ONLY valid JSON.`;
  const result = await callLlm(prompt, systemPrompt);
  if (!result) return null;
  const items = Array.isArray(result.items) ? result.items : (Array.isArray(result) ? result : []);
  return items.filter((x) => x && typeof x.document === "string" && x.document.length > 2);
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
