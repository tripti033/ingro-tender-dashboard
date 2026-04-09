/**
 * One-time import script: reads "Coming Tenders" sheet from the Excel file
 * and writes all tenders to Firestore with the full schema.
 *
 * Run: node scraper/import-excel.js
 */
import "dotenv/config";
import XLSX from "xlsx";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const XLSX_PATH = "./BESS Tenders and Enquiries (1).xlsx";

// Firebase init
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

// Read Excel
const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets["Coming Tenders"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

// The sheet is transposed: rows are fields, columns are tenders
// Row 0 = "Basic Details" header
// Row 1 = NIT Numbers, Row 2 = Category, etc.
// Column 0 = field labels, Column 1+ = tender data

// How many tenders? Count non-empty cells in row 1 (NIT numbers)
const nitRow = rows[1] || [];
const tenderCount = nitRow.length - 1; // minus label column
console.log(`Found ${tenderCount} tenders in Excel\n`);

/**
 * Parse an Excel date value. Excel stores dates as serial numbers (days since 1900-01-01).
 * Can also be a string like "28-03-2026 Up to 16:00 Hrs".
 */
function parseExcelDate(val) {
  if (val == null || val === "") return null;

  // Excel serial number
  if (typeof val === "number" && val > 40000 && val < 60000) {
    const date = new Date((val - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  }

  // String date
  if (typeof val === "string") {
    // Try "DD-MM-YYYY" or "DD/MM/YYYY"
    const dmy = val.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) {
      const d = new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
      return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
    }
    // Try "DD/MM/YYYY, HH:MM"
    const dmyTime = val.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyTime) {
      const d = new Date(parseInt(dmyTime[3]), parseInt(dmyTime[2]) - 1, parseInt(dmyTime[1]));
      return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
    }
    // Try ISO or other parseable formats
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
  }

  return null;
}

/**
 * Parse a number, handling strings with commas and text.
 */
function parseNum(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Sanitise NIT for Firestore doc ID.
 */
function sanitiseNit(nit) {
  if (!nit) return null;
  return String(nit)
    .trim()
    .replace(/[\s/\\.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

function getCell(rowIndex, colIndex) {
  const row = rows[rowIndex];
  if (!row) return null;
  const val = row[colIndex];
  return val == null || val === "" ? null : val;
}

function getStr(rowIndex, colIndex) {
  const v = getCell(rowIndex, colIndex);
  return v != null ? String(v).trim() : null;
}

const now = Timestamp.now();
let written = 0;

for (let col = 1; col <= tenderCount; col++) {
  const rawNit = getStr(1, col);
  if (!rawNit) continue;

  const nitNumber = sanitiseNit(rawNit);
  if (!nitNumber) continue;

  const authority = getStr(3, col);
  const powerMW = parseNum(getCell(6, col));
  const energyMWh = parseNum(getCell(7, col));
  const bidDeadline = parseExcelDate(getCell(13, col));

  // Compute days left
  let daysLeft = null;
  let tenderStatus = "active";
  if (bidDeadline) {
    const deadlineDate = bidDeadline.toDate();
    daysLeft = Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) tenderStatus = "closed";
    else if (daysLeft <= 7) tenderStatus = "closing_soon";
  }

  // Build title from authority + capacity + location
  const location = getStr(4, col);
  const category = getStr(2, col);
  const title = [
    authority,
    powerMW ? `${powerMW} MW` : null,
    energyMWh ? `/ ${energyMWh} MWh` : null,
    category,
    location ? `— ${location}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const tender = {
    nitNumber,
    title,

    // Basic Details
    category: category || null,
    tenderMode: getStr(5, col),
    authority: authority || null,
    authorityType: null,
    state: location || null,
    location: location || null,
    powerMW,
    energyMWh,
    durationHours: powerMW && energyMWh ? Math.round((energyMWh / powerMW) * 100) / 100 : null,
    connectivityType: getStr(8, col),
    biddingStructure: getStr(9, col),
    bespaSigning: getStr(10, col),

    // Key Dates
    preBidDate: parseExcelDate(getCell(11, col)),
    preBidLink: getStr(12, col),
    bidDeadline,
    emdDeadline: parseExcelDate(getCell(14, col)),
    techBidOpeningDate: parseExcelDate(getCell(15, col)),
    financialBidOpeningDate: parseExcelDate(getCell(16, col)),
    documentLink: getStr(17, col),

    // Technical Details
    minimumBidSize: getStr(20, col),
    maxAllocationPerBidder: getStr(21, col),
    gridConnected: getStr(22, col),
    roundTripEfficiency: getStr(23, col),
    minimumAnnualAvailability: getStr(24, col),
    dailyCycles: parseNum(getCell(25, col)),

    // Financial Details
    financialClosure: getStr(28, col),
    scodMonths: getStr(29, col),
    gracePeriod: getStr(30, col),
    tenderProcessingFee: parseNum(getCell(31, col)),
    tenderDocumentFee: parseNum(getCell(32, col)),
    vgfAmount: parseNum(getCell(33, col)),
    vgfEligible: getCell(33, col) != null && parseNum(getCell(33, col)) > 0,
    emdAmount: parseNum(getCell(34, col)),
    emdUnit: "INR",
    pbgAmount: parseNum(getCell(35, col)),
    successCharges: parseNum(getCell(36, col)),
    paymentSecurityFund: parseNum(getCell(37, col)),
    portalRegistrationFee: parseNum(getCell(38, col)),
    totalCost: parseNum(getCell(40, col)),

    // Status
    daysLeft,
    tenderStatus,

    // Sources & Links
    sourceUrl: getStr(17, col),
    sources: ["Excel Import"],

    // Team
    flags: {},
    notes: {},

    // Metadata
    firstSeenAt: now,
    lastUpdatedAt: now,
  };

  try {
    await setDoc(doc(db, "tenders", nitNumber), tender);
    written++;
    console.log(`[${written}] ${nitNumber} — ${title.slice(0, 60)}`);
  } catch (err) {
    console.error(`Failed: ${nitNumber} — ${err.message}`);
  }
}

console.log(`\nDone. Imported ${written} tenders.`);
process.exit(0);
