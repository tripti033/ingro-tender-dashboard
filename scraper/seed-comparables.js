/**
 * Seed the 19 historical awarded BESS tenders from the UJVNL Dhakrani
 * workbook's "Comparable Tenders" sheet. These give the dashboard a
 * real benchmark pool for pricing new tenders — Feature 2 on the
 * tender detail page matches against these by duration + capacity +
 * VGF band to show "what did comparable projects bid at?".
 *
 * Safe to re-run: uses setDoc with a stable slug per tender.
 *
 * Usage:
 *   node scraper/seed-comparables.js
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

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

// Convert "Jan-2026" / "H2-2025" / "Jul-2025" / "2024" / "Mid-2025" → a rough Timestamp
function parseAwardDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/^([A-Za-z]+)-?(\d{4})$/);
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, h1: 3, h2: 9, mid: 5, early: 2, late: 10 };
  if (m) {
    const monIdx = months[m[1].toLowerCase()] ?? 0;
    return Timestamp.fromDate(new Date(Date.UTC(Number(m[2]), monIdx, 15)));
  }
  const y = str.match(/^(\d{4})$/);
  if (y) return Timestamp.fromDate(new Date(Date.UTC(Number(y[1]), 5, 15)));
  return null;
}

function firstInt(s) {
  if (s == null) return null;
  const m = String(s).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function normGeography(s) {
  if (!s) return null;
  const lower = String(s).toLowerCase();
  if (lower.includes("desert")) return "Desert";
  if (lower.includes("hill")) return "Hill";
  if (lower.includes("coast")) return "Coastal";
  if (lower.includes("plateau")) return "Plateau";
  if (lower.includes("plain")) return "Plains";
  return "Mixed";
}

// Rows transcribed from the Comparable Tenders sheet. 19 past tenders
// (#20 in the sheet is THIS tender itself — skipped, we seeded it separately).
const ROWS = [
  { agency: "APTRANSCO 1GW/2GWh (VGF Tranche 2)", state: "Andhra Pradesh", mw: 1000, mwh: 2000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 1.8, tariff: 148000, award: "Dec-2025", bidders: 7, geo: "Plains", notes: "Lowest ever 2hr VGF bid; VGF2 ₹1.8L/MWh", winner: null },
  { agency: "GUVNL Phase VII (VGF Tranche 2)", state: "Gujarat", mw: 445, mwh: 890, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 1.8, tariff: 185000, award: "Jan-2026", bidders: null, geo: "Plains", notes: "KPI Green won; VGF2", winner: "KPI Green Energy" },
  { agency: "RVUNL 1GW/2GWh (VGF Tranche 2)", state: "Rajasthan", mw: 1000, mwh: 2000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 1.8, tariff: 177500, award: "H2-2025", bidders: 11, geo: "Desert/Plains", notes: "Second lowest 2hr VGF bid", winner: null },
  { agency: "MSEDCL 1GW/2GWh (VGF Tranche 2)", state: "Maharashtra", mw: 1000, mwh: 2000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 1.8, tariff: 165000, award: "H2-2025", bidders: null, geo: "Plains", notes: "Aggressive pricing, large scale", winner: null },
  { agency: "NHPC 500MW/1GWh AP Tranche II (VGF1)", state: "Andhra Pradesh", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 2.7, tariff: 208000, award: "Jul-2025", bidders: 3, geo: "Plains", notes: "Lowest VGF1 bid; Patel Infra L1", winner: "Patel Infrastructure" },
  { agency: "NVVN 500MW/1GWh Rajasthan (VGF1)", state: "Rajasthan", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 2.7, tariff: 216000, award: "Jun-2025", bidders: 5, geo: "Desert/Plains", notes: "Solar91 Cleantech L1", winner: "Solar91 Cleantech" },
  { agency: "KPTCL 500MW/1GWh Karnataka (VGF1)", state: "Karnataka", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 2.7, tariff: 254000, award: "Mid-2025", bidders: null, geo: "Plains/Plateau", notes: "Pace Digitek 250MW winner", winner: "Pace Digitek" },
  { agency: "GUVNL Phase IV 400MW/800MWh (VGF1)", state: "Gujarat", mw: 400, mwh: 800, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 2.7, tariff: 226000, award: "Nov-2024", bidders: null, geo: "Plains", notes: "HG Infra L1; 40% drop from Ph3", winner: "HG Infra" },
  { agency: "MSEDCL 300MW/600MWh (VGF1)", state: "Maharashtra", mw: 300, mwh: 600, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 2.7, tariff: 219001, award: "Aug-2024", bidders: null, geo: "Plains", notes: "First sub-₹2.2L VGF1 bid", winner: null },
  { agency: "RVUNL 500MW/1GWh (VGF1)", state: "Rajasthan", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 2.7, tariff: 221100, award: "Nov-2024", bidders: null, geo: "Desert/Plains", notes: "Early VGF1 benchmark", winner: null },
  { agency: "GUVNL Phase VI 500MW/1GWh (No VGF)", state: "Gujarat", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 0, tariff: 280000, award: "Apr-2025", bidders: null, geo: "Plains", notes: "Lowest non-VGF 2hr bid", winner: null },
  { agency: "GUVNL Phase III 500MW/1GWh (No VGF)", state: "Gujarat", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 0, tariff: 372000, award: "2024", bidders: null, geo: "Plains", notes: "Pre-VGF era benchmark", winner: null },
  { agency: "GUVNL Phase I 250MW/500MWh (No VGF)", state: "Gujarat", mw: 250, mwh: 500, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 0, tariff: 449000, award: "Mar-2024", bidders: 2, geo: "Plains", notes: "IndiGrid/Gensol won", winner: "IndiGrid / Gensol" },
  { agency: "NVVN 250MW/500MWh Kerala (VGF2)", state: "Kerala", mw: 250, mwh: 500, hrs: 2, cycles: 1.15, yrs: 15, model: "BOO", vgf: 1.8, tariff: 181000, award: "Jan-2026", bidders: 6, geo: "Coastal/Plains", notes: "Record low; 420 cycles/yr only", winner: null },
  { agency: "SJVN 375MW/1500MWh UP (VGF1, 4hr)", state: "Uttar Pradesh", mw: 375, mwh: 1500, hrs: 4, cycles: 1, yrs: 20, model: "BOO", vgf: 2.7, tariff: 359000, award: "Jul-2025", bidders: 18, geo: "Plains", notes: "Lowest 4hr VGF bid; Patel Infra L1", winner: "Patel Infrastructure" },
  { agency: "SECI 125MW/500MWh Kerala (VGF1, 4hr)", state: "Kerala", mw: 125, mwh: 500, hrs: 4, cycles: 1, yrs: 15, model: "BOO", vgf: 2.7, tariff: 441000, award: "Feb-2025", bidders: 7, geo: "Hilly/Coastal", notes: "JSW won; similar geography challenge", winner: "JSW Energy" },
  { agency: "BSPGCL 125MW/500MWh Bihar (VGF1, 4hr)", state: "Bihar", mw: 125, mwh: 500, hrs: 4, cycles: 1, yrs: 12, model: "BOOT", vgf: 2.7, tariff: 444000, award: "Jul-2025", bidders: 6, geo: "Plains", notes: "Highest 4hr VGF tariff; small bidders", winner: null },
  { agency: "TNGECL 375MW/1500MWh TN (VGF2, 4hr, 1.5cyc)", state: "Tamil Nadu", mw: 375, mwh: 1500, hrs: 4, cycles: 1.5, yrs: 15, model: "BOO", vgf: 1.8, tariff: 315000, award: "Jan-2026", bidders: 6, geo: "Plains", notes: "Lowest 4hr despite 1.5 cycles!", winner: null },
  { agency: "SECI 500MW/1GWh (First ever, 2022)", state: "Pan India", mw: 500, mwh: 1000, hrs: 2, cycles: 2, yrs: 12, model: "BOO", vgf: 0, tariff: 1083000, award: "2022", bidders: null, geo: "Mixed", notes: "Historical; cancelled later", winner: null },
];

function slug(agency) {
  return agency
    .replace(/\(.*?\)/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 80);
}

let created = 0, updated = 0;
for (const r of ROWS) {
  const nit = `BENCH-${slug(r.agency)}`;
  const authority = (r.agency.match(/^([A-Z]+)/) || [])[1] || null;
  const title = `${r.agency} — ${r.mw}MW/${r.mwh}MWh standalone BESS (historical benchmark)`;
  const tariffBand = r.vgf === 1.8 ? "VGF2" : r.vgf === 2.7 ? "VGF1" : r.vgf === 0 ? "No-VGF" : null;

  const data = {
    nitNumber: nit,
    title,
    authority,
    state: r.state,
    category: "Standalone",
    tenderMode: r.model,
    powerMW: r.mw,
    energyMWh: r.mwh,
    durationHours: r.hrs,
    cyclesPerDay: r.cycles,
    contractModel: r.model,
    geographyType: normGeography(r.geo),
    numBidders: firstInt(r.bidders),
    tariffRsPerMwPerMonth: r.tariff,
    vgfRateLakhPerMwh: r.vgf,
    tariffBand,
    awardDate: parseAwardDate(r.award),
    awardedTo: r.winner,
    developedBy: null,
    summary: r.notes,
    tenderStatus: "awarded",
    daysLeft: null,
    bidDeadline: null,
    emdDeadline: null,
    documentLink: null,
    sourceUrl: null,
    resultSources: [],
    contactPerson: null,
    contactEmail: null,
    contactPhone: null,
    isCorrigendum: false,
    corrigendumOf: null,
    sources: ["excel-comparables-seed"],
    flags: {},
    notes: {},
    firstSeenAt: Timestamp.now(),
    lastUpdatedAt: Timestamp.now(),
  };

  await setDoc(doc(db, "tenders", nit), data, { merge: true });
  created++;
  console.log(`  ✓ ${nit}  (${r.tariff.toLocaleString()} ₹/MW/Mo, VGF ${r.vgf}L/MWh, ${r.hrs}h)`);
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Seeded ${created} comparable benchmark tenders`);
process.exit(0);
