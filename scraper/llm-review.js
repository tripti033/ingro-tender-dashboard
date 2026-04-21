/**
 * LLM Review Mode — extracts fields from titles and PDFs, shows diffs
 * for human approval before writing to Firestore.
 *
 * Usage:
 *   node scraper/llm-review.js                # Review all tenders with gaps
 *   node scraper/llm-review.js --pdf          # Also extract from PDFs
 *   node scraper/llm-review.js --retry-failed # Include tenders LLM previously failed on
 *   node scraper/llm-review.js <nitNumber>    # Review a specific tender
 *
 * Tenders where LLM extracts nothing get llmExtractionFailed: true so
 * they are skipped on future runs. Pass --retry-failed to include them,
 * or extract succeeds once → the flag clears automatically.
 *
 * Controls:
 *   y = approve and write to Firestore
 *   n = skip
 *   a = approve all remaining without prompting
 *   q = quit
 */
import "dotenv/config";
import readline from "readline";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { extractTenderFields, extractPdfFields, isLlmAvailable } from "./llm.js";
import { enrichFromPdf } from "./pdf-parser.js";

// ── Firebase init ──

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
await signInWithEmailAndPassword(
  auth,
  process.env.FIREBASE_SCRAPER_EMAIL,
  process.env.FIREBASE_SCRAPER_PASSWORD
);
const db = getFirestore(app);

// ── CLI args ──

const args = process.argv.slice(2);
const doPdf = args.includes("--pdf");
const retryFailed = args.includes("--retry-failed");
const targetNit = args.find((a) => !a.startsWith("--"));

// ── Readline for user input ──

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── Color helpers for terminal ──

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function printDiff(field, current, suggested) {
  const cur = current == null ? "empty" : String(current);
  const sug = suggested == null ? "empty" : String(suggested);
  if (cur === sug) return false; // no change
  console.log(`  ${CYAN}${field}${RESET}: ${RED}${cur}${RESET} → ${GREEN}${sug}${RESET}`);
  return true;
}

// ── Main ──

async function main() {
  if (!(await isLlmAvailable())) {
    console.error("Ollama is not running. Start it with: ollama serve");
    process.exit(1);
  }

  // Load all tenders
  const snap = await getDocs(collection(db, "tenders"));
  const allTenders = snap.docs.map((d) => ({ nitNumber: d.id, ...d.data() }));
  console.log(`\nLoaded ${allTenders.length} tenders from Firestore\n`);

  // Filter candidates
  const candidates = allTenders.filter((t) => {
    if (targetNit) return t.nitNumber === targetNit;
    // Skip tenders where LLM previously returned nothing useful,
    // unless --retry-failed is passed
    if (t.llmExtractionFailed && !retryFailed) return false;
    // Has gaps in key fields
    return (
      t.powerMW == null ||
      t.energyMWh == null ||
      !t.category ||
      !t.state ||
      !t.tenderMode ||
      (doPdf && t.documentLink && !t.minimumBidSize)
    );
  });

  const failedSkipped = allTenders.filter((t) => t.llmExtractionFailed && !retryFailed).length;
  console.log(`${candidates.length} tenders need enrichment${failedSkipped > 0 ? ` (${failedSkipped} previously failed, run with --retry-failed to include)` : ""}\n`);
  console.log(`${BOLD}Controls: y=approve  n=skip  a=approve-all  q=quit${RESET}\n`);

  let approveAll = false;
  let approved = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const tender = candidates[i];

    console.log(`\n${"─".repeat(70)}`);
    console.log(
      `${BOLD}[${i + 1}/${candidates.length}] ${tender.nitNumber}${RESET}`
    );
    console.log(`${DIM}${(tender.title || "").slice(0, 120)}${RESET}`);
    console.log();

    const updates = {};
    let hasChanges = false;

    // ── Step 1: LLM title extraction ──

    const llmFields = await extractTenderFields(
      tender.title || "",
      tender.description || ""
    );

    if (llmFields) {
      console.log(`${YELLOW}From title (LLM):${RESET}`);
      const titleFields = [
        "powerMW", "energyMWh", "authority", "category",
        "tenderMode", "location", "state", "connectivityType",
      ];

      for (const field of titleFields) {
        const current = tender[field] ?? null;
        const suggested = llmFields[field] ?? null;
        if (suggested != null && current == null) {
          if (printDiff(field, current, suggested)) {
            updates[field] = suggested;
            hasChanges = true;
          }
        }
      }

      // Compute derived fields
      if (updates.powerMW || updates.energyMWh) {
        const mw = updates.powerMW || tender.powerMW;
        const mwh = updates.energyMWh || tender.energyMWh;
        if (mw && mwh) {
          updates.durationHours = Math.round((mwh / mw) * 100) / 100;
          printDiff("durationHours", tender.durationHours, updates.durationHours);
        }
      }
    }

    // ── Step 2: PDF extraction (if --pdf flag) ──
    // Run PDF extraction if the tender has a documentLink AND at least one
    // PDF-extractable field is still missing. Previously this was gated on
    // !minimumBidSize which blocked re-runs once the first field was filled,
    // preventing contact details (often in later pages) from ever being
    // extracted.
    const PDF_FIELDS = [
      "minimumBidSize", "maxAllocationPerBidder", "gridConnected",
      "roundTripEfficiency", "minimumAnnualAvailability", "dailyCycles",
      "financialClosure", "scodMonths", "gracePeriod",
      "tenderProcessingFee", "tenderDocumentFee", "vgfAmount",
      "emdAmount", "pbgAmount", "successCharges", "paymentSecurityFund",
      "portalRegistrationFee", "biddingStructure", "bespaSigning",
      "connectivityType", "contactPerson", "contactEmail", "contactPhone",
      "bidSubmissionOnline", "bidSubmissionOffline", "bidOpeningDate",
    ];
    const hasPdfGaps = PDF_FIELDS.some((f) => tender[f] == null);
    let pdfRan = false;

    if (doPdf && tender.documentLink && hasPdfGaps) {
      pdfRan = true;
      console.log(`\n${YELLOW}From PDF:${RESET} ${tender.documentLink.slice(0, 80)}`);

      const pdfUpdates = await enrichFromPdf(tender);
      if (pdfUpdates && Object.keys(pdfUpdates).length > 0) {
        for (const [field, value] of Object.entries(pdfUpdates)) {
          if (value != null && tender[field] == null) {
            if (printDiff(field, tender[field], value)) {
              updates[field] = value;
              hasChanges = true;
            }
          }
        }
      } else {
        console.log(`  ${DIM}(no new fields extracted from PDF)${RESET}`);
      }
    } else if (doPdf && tender.documentLink && !hasPdfGaps) {
      console.log(`  ${DIM}(skipping PDF — all PDF fields already filled)${RESET}`);
    }

    // ── Step 3: Approval ──

    if (!hasChanges) {
      // Only mark as "LLM-failed" if we actually invoked the LLM on content.
      // If we skipped because all fields are already filled, the tender is
      // complete — don't penalise it on future runs.
      const actuallyRan = !!llmFields || pdfRan;
      if (actuallyRan) {
        console.log(`  ${DIM}(no new fields — marking llmExtractionFailed)${RESET}`);
        try {
          await updateDoc(doc(db, "tenders", tender.nitNumber), {
            llmExtractionFailed: true,
            llmExtractionAttemptedAt: Timestamp.now(),
          });
        } catch (err) {
          console.log(`  ${RED}Failed-flag write failed: ${err.message}${RESET}`);
        }
      } else {
        console.log(`  ${DIM}(all fields already filled — skipping)${RESET}`);
      }
      skipped++;
      continue;
    }

    let choice;
    if (approveAll) {
      choice = "y";
      console.log(`\n  ${GREEN}Auto-approved${RESET}`);
    } else {
      const answer = await ask(`\n  ${BOLD}Apply these changes? [y/n/a/q]: ${RESET}`);
      choice = answer.trim().toLowerCase();
    }

    if (choice === "q") {
      console.log("\nQuitting.");
      break;
    } else if (choice === "a") {
      approveAll = true;
      choice = "y";
      console.log(`  ${GREEN}Approving all remaining...${RESET}`);
    }

    if (choice === "y") {
      try {
        await updateDoc(doc(db, "tenders", tender.nitNumber), {
          ...updates,
          llmExtractionFailed: false,
          llmExtractionAttemptedAt: Timestamp.now(),
          lastUpdatedAt: Timestamp.now(),
        });
        console.log(`  ${GREEN}Written to Firestore${RESET}`);
        approved++;
      } catch (err) {
        console.log(`  ${RED}Write failed: ${err.message}${RESET}`);
      }
    } else {
      console.log(`  ${DIM}Skipped${RESET}`);
      skipped++;
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`${BOLD}Done.${RESET} Approved: ${GREEN}${approved}${RESET} | Skipped: ${DIM}${skipped}${RESET}`);

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
