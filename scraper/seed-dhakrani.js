/**
 * One-shot: seed the UJVNL Dhakrani 30MW/75MWh BESS tender as a demo
 * record with rich, hand-verified fields. Uses the data from the RfP
 * workbook the team has been using internally.
 *
 * Usage:
 *   node scraper/seed-dhakrani.js
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, Timestamp,
} from "firebase/firestore";
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

const nit = "UJVNL-T-04-EE-Solar-2025-26";
const ref = doc(db, "tenders", nit);
const existing = await getDoc(ref);

const data = {
  nitNumber: nit,
  title: "Setting up of 30 MW / 75 MWh BESS at Dhakrani S/s, Dhakrani HEP (Dehradun, Uttarakhand)",
  authority: "UJVNL",
  authorityType: "State Utility",
  category: "Standalone",
  tenderMode: "BOOT",
  state: "Uttarakhand",
  location: "Dhakrani 132/33 kV S/s, Dehradun",
  powerMW: 30,
  energyMWh: 75,
  durationHours: 2.5,
  connectivityType: "STU / ISC",
  biddingStructure: "VGF Tranche 2 (₹1.8 Lakh/MWh)",
  bespaSigning: null,
  // Dates (IST — converted to UTC Timestamps below)
  preBidDate: Timestamp.fromDate(new Date("2026-02-12T14:30:00+05:30")),
  bidDeadline: Timestamp.fromDate(new Date("2026-02-25T16:00:00+05:30")),
  emdDeadline: Timestamp.fromDate(new Date("2026-02-28T12:00:00+05:30")),
  techBidOpeningDate: Timestamp.fromDate(new Date("2026-02-28T15:00:00+05:30")),
  financialBidOpeningDate: null,
  // bidOpeningDate / bidSubmission* are schema-defined as strings (they come
  // verbatim from tender docs where the format varies), NOT Timestamps.
  bidOpeningDate: "28-02-2026 15:00 hrs",
  bidSubmissionOnline: "25-02-2026 16:00 hrs",
  bidSubmissionOffline: "28-02-2026 12:00 hrs",
  // Financials
  emdAmount: 15000000,             // ₹1.5 Crore
  totalCost: 1709800000,           // ₹170.98 Crore estimated project cost
  vgfAmount: 13500000,             // ₹1.35 Crore (18 L/MWh × 75 MWh)
  pbgAmount: 37500000,             // ₹3.75 Crore
  tenderProcessingFee: 885000,     // ₹8.85 Lakh (incl 18% GST)
  tenderDocumentFee: 5900,         // ₹5,900 (incl 18% GST)
  // Technical
  minimumBidSize: null,
  maxAllocationPerBidder: "Max 2 of 3 packages per bidder (Dhakrani / Tiloth / Khatima)",
  gridConnected: "33 kV at Dhakrani 132/33 kV S/s; developer builds 33 kV bay + line",
  roundTripEfficiency: "≥ 85% AC-AC monthly",
  minimumAnnualAvailability: "≥ 95% annually",
  dailyCycles: 2,
  financialClosure: "6 months from BESPA signing",
  scodMonths: "18 months from BESPA / Date of Start",
  gracePeriod: null,
  // Misc
  documentLink: null,
  sourceUrl: "https://uktenders.gov.in",
  summary: "30 MW / 75 MWh standalone BESS at Dhakrani S/s (Dehradun, Uttarakhand) on BOOT basis for 12 years post-COD. VGF Tranche 2 (₹1.8 L/MWh = ₹1.35 Cr total). Ceiling tariff ₹3,96,747/MW/Month (UERC order). Land provided free (4,680 sqm). Domestic bidders only, consortium up to 3 partners with lead ≥ 51%. Part of 3-package 60 MW/150 MWh tender — max 2 packages per bidder.",
  contactPerson: null,
  contactEmail: null,
  contactPhone: null,
  awardedTo: null,
  developedBy: null,
  tenderStatus: "active",
  daysLeft: Math.ceil((new Date("2026-02-25T16:00:00+05:30").getTime() - Date.now()) / 86400000),
  isCorrigendum: false,
  corrigendumOf: null,
  sources: ["seed-dhakrani"],
  flags: {},
  notes: {},
  firstSeenAt: existing.exists() ? existing.data().firstSeenAt : Timestamp.now(),
  lastUpdatedAt: Timestamp.now(),
};

await setDoc(ref, data, { merge: true });
console.log(`${existing.exists() ? "Updated" : "Created"} tender: ${nit}`);
console.log(`View at: /tender/${encodeURIComponent(nit)}`);
process.exit(0);
