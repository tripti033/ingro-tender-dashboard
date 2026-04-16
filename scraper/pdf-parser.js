/**
 * PDF parser — downloads a tender bid document (RfS/RfP PDF) and extracts
 * structured Technical + Financial fields using the local LLM.
 *
 * Requires Ollama running locally with a suitable model.
 * Optional dependency: pdf-parse (install with `npm install pdf-parse`).
 *
 * Usage:
 *   node scraper/pdf-parser.js              # Enrich all tenders with PDFs
 *   node scraper/pdf-parser.js <nitNumber>  # Enrich a specific tender
 */
import "dotenv/config";
import axios from "axios";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { extractPdfFields, generateTenderSummary, isLlmAvailable } from "./llm.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Download a PDF and extract its text content.
 * Uses pdf-parse if installed; otherwise returns null with a warning.
 */
async function downloadAndExtract(pdfUrl) {
  let PDFParseClass;
  try {
    const mod = await import("pdf-parse");
    PDFParseClass = mod.PDFParse;
  } catch {
    console.log("[PDF] pdf-parse not installed. Run: npm install pdf-parse");
    return null;
  }

  try {
    console.log(`[PDF] Downloading ${pdfUrl.slice(0, 80)}...`);
    const resp = await axios.get(pdfUrl, {
      headers: { "User-Agent": USER_AGENT },
      responseType: "arraybuffer",
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024, // 50 MB max
    });

    const buffer = Buffer.from(resp.data);
    const parser = new PDFParseClass({ data: buffer });
    await parser.load();
    const result = await parser.getText();
    parser.destroy();
    console.log(`[PDF] Extracted ${result.text?.length || 0} chars from ${result.total} pages`);
    return result.text || null;
  } catch (err) {
    console.log(`[PDF] Download/parse failed for ${pdfUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Enrich a tender with fields extracted from its bid document PDF.
 * Returns the updates object (only fields that were extracted).
 */
/**
 * Check if a URL likely serves a downloadable document (PDF/DOC).
 */
function isDocumentUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Direct file extensions
  if (lower.match(/\.(pdf|doc|docx|xlsx?)(\?|$)/)) return true;
  // Known download URL patterns (GeM, SECI, NTPC etc.)
  if (lower.includes("showbiddocument")) return true;
  if (lower.includes("/uploads/tender")) return true;
  if (lower.includes("/writereaddata/tender")) return true;
  if (lower.includes("download") && !lower.includes("tenderdetail.com")) return true;
  return false;
}

export async function enrichFromPdf(tender) {
  // Collect all document URLs from documents array + documentLink
  const pdfUrls = new Set();
  if (tender.documents && Array.isArray(tender.documents)) {
    for (const d of tender.documents) {
      if (isDocumentUrl(d.url)) pdfUrls.add(d.url);
    }
  }
  if (isDocumentUrl(tender.documentLink)) {
    pdfUrls.add(tender.documentLink);
  }

  if (pdfUrls.size === 0) return null;

  // Download and extract text from ALL PDFs, combine
  let combinedText = "";
  for (const url of pdfUrls) {
    const text = await downloadAndExtract(url);
    if (text && text.length > 100) {
      combinedText += `\n--- Document: ${url.split("/").pop()} ---\n${text}`;
    }
  }

  if (combinedText.length < 500) {
    console.log(`[PDF] Not enough text from ${pdfUrls.size} PDFs for ${tender.nitNumber}`);
    return null;
  }

  console.log(`[PDF] Combined ${pdfUrls.size} docs → ${combinedText.length} chars`);
  const fields = await extractPdfFields(combinedText, tender.title);
  if (!fields) return null;

  // Build update object — only include non-null fields, never overwrite existing
  const updates = {};
  const fieldsToFill = [
    "minimumBidSize",
    "maxAllocationPerBidder",
    "gridConnected",
    "roundTripEfficiency",
    "minimumAnnualAvailability",
    "dailyCycles",
    "financialClosure",
    "scodMonths",
    "gracePeriod",
    "tenderProcessingFee",
    "tenderDocumentFee",
    "vgfAmount",
    "emdAmount",
    "pbgAmount",
    "successCharges",
    "paymentSecurityFund",
    "portalRegistrationFee",
    "biddingStructure",
    "bespaSigning",
    "connectivityType",
    "contactPerson",
    "contactEmail",
    "contactPhone",
    "bidSubmissionOnline",
    "bidSubmissionOffline",
    "bidOpeningDate",
  ];

  for (const field of fieldsToFill) {
    const val = fields[field];
    if (val == null) continue;

    // Only fill if the existing value is null (don't overwrite human edits)
    if (tender[field] == null || tender[field] === "") {
      updates[field] = val;
    }
  }

  if (fields.vgfAmount && fields.vgfAmount > 0) updates.vgfEligible = true;
  if (fields.emdAmount && fields.emdAmount > 0 && !tender.emdUnit) updates.emdUnit = "INR";

  // Generate summary if tender doesn't have one
  if (!tender.summary) {
    console.log(`[PDF] Generating summary...`);
    const summary = await generateTenderSummary(combinedText, tender.title);
    if (summary) updates.summary = summary;
  }

  return updates;
}

/**
 * CLI entry point — enriches all tenders (or a specific one) with PDF data.
 */
async function main() {
  if (!(await isLlmAvailable())) {
    console.error("Ollama is not running. Start it with: ollama serve");
    process.exit(1);
  }

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

  const snap = await getDocs(collection(db, "tenders"));
  const allTenders = snap.docs.map((d) => ({ nitNumber: d.id, ...d.data() }));

  // Filter: tenders with PDF documentLink and missing technical/financial fields
  const targetNit = process.argv[2];
  const candidates = allTenders.filter((t) => {
    if (targetNit) return t.nitNumber === targetNit;
    if (!t.documentLink || !t.documentLink.toLowerCase().includes(".pdf")) return false;
    // Skip if already enriched (has min bid size or RTE)
    if (t.minimumBidSize || t.roundTripEfficiency) return false;
    return true;
  });

  console.log(`\nEnriching ${candidates.length} tenders from PDFs...\n`);

  let enriched = 0;
  for (const tender of candidates) {
    console.log(`\n[${tender.nitNumber}] ${tender.title?.slice(0, 60)}`);
    const updates = await enrichFromPdf(tender);
    if (!updates || Object.keys(updates).length === 0) {
      console.log("  → no new fields extracted");
      continue;
    }

    const fieldCount = Object.keys(updates).length;
    console.log(`  → extracted ${fieldCount} fields: ${Object.keys(updates).join(", ")}`);

    // Write back to Firestore
    try {
      await updateDoc(doc(db, "tenders", tender.nitNumber), {
        ...updates,
        lastUpdatedAt: Timestamp.now(),
      });
      enriched++;
    } catch (err) {
      console.log(`  → write failed: ${err.message}`);
    }
  }

  console.log(`\nDone. Enriched ${enriched}/${candidates.length} tenders.`);
  process.exit(0);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
