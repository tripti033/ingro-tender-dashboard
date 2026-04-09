/**
 * One-time import: reads Bid Winners, Bid Losers, Directory, Leads from Excel
 * and writes companies, contacts, and bids to Firestore.
 *
 * Run: node scraper/import-crm.js
 */
import "dotenv/config";
import XLSX from "xlsx";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, addDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, process.env.FIREBASE_SCRAPER_EMAIL, process.env.FIREBASE_SCRAPER_PASSWORD);
const db = getFirestore(app);

const wb = XLSX.readFile("./BESS Tenders and Enquiries (1).xlsx");
const now = Timestamp.now();

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function parseNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

// ── 1. Collect all unique companies ──

const companyMap = new Map(); // slug → { name, type, bidsWon, bidsLost, totalCapacityMWh }

// Known electricity boards
const BOARDS = new Set([
  "SECI", "NTPC", "GUVNL", "MSEDCL", "RRVUNL", "TNGECL", "SJVNL", "DHBVN",
  "WBSEDCL", "MSETCL", "UJVNL", "NVVN", "NHPC", "PGCIL", "POWERGRID", "MNRE",
  "CEA", "TRANSCO", "KSEBL", "CESC", "CSPDCL", "UPPCL", "DMRC", "HPPCL",
  "NTPC Green", "BSES", "DNHDDPCL", "PED", "RSPDCL", "TGGENCO",
]);

function getOrCreateCompany(name) {
  if (!name || name.trim().length < 2) return null;
  const slug = slugify(name);
  if (!companyMap.has(slug)) {
    const isBoard = BOARDS.has(name.trim()) || BOARDS.has(name.trim().toUpperCase());
    companyMap.set(slug, {
      name: name.trim(),
      type: isBoard ? "Board" : "Developer",
      bidsWon: 0,
      bidsLost: 0,
      totalCapacityMWh: 0,
    });
  }
  return slug;
}

// ── 2. Process Bid Winners ──

const bids = [];
const winners = XLSX.utils.sheet_to_json(wb.Sheets["Bid Winner"], { header: 1 });
for (let i = 1; i < winners.length; i++) {
  const r = winners[i];
  const companyName = r[0] ? String(r[0]).trim() : null;
  if (!companyName) continue;

  const slug = getOrCreateCompany(companyName);
  if (!slug) continue;

  const capacity = parseNum(r[3]);
  companyMap.get(slug).bidsWon++;
  if (capacity) companyMap.get(slug).totalCapacityMWh += capacity;

  bids.push({
    companyId: slug,
    companyName,
    tenderNit: r[8] ? String(r[8]).trim() : "",
    tenderName: r[1] ? String(r[1]).trim() : "",
    category: r[2] ? String(r[2]).trim() : null,
    capacityMWh: capacity,
    priceStandalone: parseNum(r[4]),
    priceFDRE: parseNum(r[5]),
    state: r[6] ? String(r[6]).trim() : null,
    result: "won",
    reference: r[7] ? String(r[7]).trim() : null,
  });
}
console.log(`Bid Winners: ${bids.filter(b => b.result === "won").length}`);

// ── 3. Process Bid Losers ──

const losers = XLSX.utils.sheet_to_json(wb.Sheets["Bid Losers "], { header: 1 });
for (let i = 1; i < losers.length; i++) {
  const r = losers[i];
  const companyName = r[0] ? String(r[0]).trim() : null;
  if (!companyName) continue;

  const slug = getOrCreateCompany(companyName);
  if (!slug) continue;

  const capacity = parseNum(r[2]);
  companyMap.get(slug).bidsLost++;

  bids.push({
    companyId: slug,
    companyName,
    tenderNit: r[6] ? String(r[6]).trim() : "",
    tenderName: r[6] ? String(r[6]).trim() : "",
    category: r[5] ? String(r[5]).trim() : null,
    capacityMWh: capacity,
    priceStandalone: parseNum(r[3]),
    priceFDRE: parseNum(r[4]),
    state: null,
    result: "lost",
    reference: null,
  });
}
console.log(`Bid Losers: ${bids.filter(b => b.result === "lost").length}`);

// ── 4. Process Leads (add companies + contacts) ──

const contacts = [];
const leads = XLSX.utils.sheet_to_json(wb.Sheets["Leads"], { header: 1 });
for (let i = 1; i < leads.length; i++) {
  const r = leads[i];
  const companyName = r[0] ? String(r[0]).trim() : null;
  if (!companyName) continue;

  const slug = getOrCreateCompany(companyName);
  if (!slug) continue;

  // Add contact if POC exists
  const pocName = r[6] ? String(r[6]).trim() : null;
  if (pocName && pocName.length > 1) {
    contacts.push({
      name: pocName,
      companyId: slug,
      companyName,
      designation: r[7] ? String(r[7]).trim() : null,
      email: r[8] ? String(r[8]).trim() : null,
      phone: r[9] ? String(r[9]).toString().trim() : null,
      location: r[3] ? String(r[3]).trim() : null,
    });
  }
}

// ── 5. Process Directory (more contacts) ──

const dir = XLSX.utils.sheet_to_json(wb.Sheets["Directory"], { header: 1 });
for (let i = 1; i < dir.length; i++) {
  const r = dir[i];
  const companyName = r[0] ? String(r[0]).trim() : null;
  if (!companyName) continue;

  getOrCreateCompany(companyName);
  const slug = slugify(companyName);

  const prospectName = r[1] ? String(r[1]).trim() : null;
  if (prospectName && prospectName.length > 1) {
    contacts.push({
      name: prospectName,
      companyId: slug,
      companyName,
      designation: r[2] ? String(r[2]).trim() : null,
      email: r[3] ? String(r[3]).trim() : null,
      phone: r[4] ? String(r[4]).toString().trim() : null,
      location: r[5] ? String(r[5]).trim() : null,
    });
  }
}

// Dedup contacts by name+company
const seenContacts = new Set();
const uniqueContacts = contacts.filter(c => {
  const key = `${c.companyId}|${c.name.toLowerCase()}`;
  if (seenContacts.has(key)) return false;
  seenContacts.add(key);
  return true;
});

console.log(`\nCompanies: ${companyMap.size}`);
console.log(`Contacts: ${uniqueContacts.length}`);
console.log(`Bids: ${bids.length}`);

// ── 6. Write to Firestore ──

console.log("\nWriting companies...");
let written = 0;
for (const [slug, data] of companyMap) {
  await setDoc(doc(db, "companies", slug), { ...data, createdAt: now });
  written++;
}
console.log(`  ${written} companies written`);

console.log("Writing contacts...");
written = 0;
for (const c of uniqueContacts) {
  await addDoc(collection(db, "contacts"), c);
  written++;
}
console.log(`  ${written} contacts written`);

console.log("Writing bids...");
written = 0;
for (const b of bids) {
  await addDoc(collection(db, "bids"), b);
  written++;
}
console.log(`  ${written} bids written`);

console.log("\nDone!");
process.exit(0);
