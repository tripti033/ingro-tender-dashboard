/**
 * One-shot: backfill every BESS tender from UJVNL's full historical archive.
 *
 * Their archive page (https://ujvnl.com/tenders-archieve) returns ALL 10,964
 * entries in a single HTML response (~12 MB). The "1097 pages" control at the
 * bottom is a client-side DataTables widget, not server-side pagination — so
 * one fetch pulls the full dataset.
 *
 * We strict-filter for real BESS keywords (loose "mwh" / "storage" matches
 * alone catch water-tank & hydro tenders), then write each match into
 * tenders/* with tenderStatus="closed" so they land on /archives.
 *
 * Usage:
 *   node scraper/ujvnl-archive-backfill.js --dry   # preview matches
 *   node scraper/ujvnl-archive-backfill.js         # apply
 */
import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const ARCHIVE_URL = "https://ujvnl.com/tenders-archieve";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run");

// Hard BESS signals — if any of these appear, the row is definitively BESS.
// UJVNL archive is 10K rows of hydro / civil / DC-battery-bank work; we only
// want grid-scale BESS.
const HARD_SIGNALS = [
  "bess",
  "battery energy storage",
  "standalone battery",
  "pumped storage",
  "pumped hydro storage",
  "fdre",
  "firm and dispatchable",
];
// Soft signals — require a grid-scale MW/MWh rating alongside to count.
// "battery bank" + "48V/300AH" are DC plant supplies, not BESS.
const SOFT_SIGNALS = ["lithium", "lifepo", "lfp"];

function isRealBess(description) {
  const d = description.toLowerCase();

  // Hard exclusions — DC battery banks on hydro plants mention these units
  // and are never grid-scale BESS.
  if (/\d+\s*vdc|\d+\s*volt\s*dc|\d+\s*ah\b|\d+\s*a\.?h\b/i.test(description)) return false;

  if (HARD_SIGNALS.some((kw) => d.includes(kw))) return true;

  const hasSoft = SOFT_SIGNALS.some((kw) => d.includes(kw)) || d.includes("battery");
  if (!hasSoft) return false;

  // For soft-signal matches, require an explicit MWh rating. Grid-scale BESS
  // is always spec'd in MWh; "5 MW" alone usually refers to hydro plant size.
  return /\d[\d,.]*\s*mwh/i.test(description);
}

function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+05:30`);
  return isNaN(+d) ? null : d;
}

function sanitiseNit(nit) {
  return String(nit)
    .trim()
    .replace(/[\s/\\.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 150);
}

console.log(`Fetching ${ARCHIVE_URL}...`);
const resp = await axios.get(ARCHIVE_URL, {
  headers: { "User-Agent": USER_AGENT },
  timeout: 120000,
  maxContentLength: 50 * 1024 * 1024,
});
console.log(`Got ${resp.data.length.toLocaleString()} bytes`);
const $ = cheerio.load(resp.data);

const allRows = $("table tr").toArray();
console.log(`Total rows in table: ${allRows.length}`);

const matches = [];
for (let idx = 0; idx < allRows.length; idx++) {
  const row = allRows[idx];
  const cells = $(row).find("td");
  if (cells.length < 8) continue;

  const description = $(cells[cells.length - 2]).text().trim();
  if (!isRealBess(description)) continue;

  const nitLink = $(cells[1]).find("a").first();
  const nitRaw = nitLink.text().trim();
  const pdfHref = nitLink.attr("href") || null;
  if (!nitRaw) continue;

  const uploadDate = $(cells[2]).text().trim();
  const closingDate = $(cells[3]).text().trim();
  // col 4 is opening-date but wrapped in HTML comment; cheerio may return empty
  // circle = first cell after the comment block; cells[4] depending on structure
  // Safer: take 3rd-from-last for Circle, 2nd-from-last for description
  const circle = $(cells[cells.length - 5]).text().trim();
  const address = $(cells[cells.length - 4]).text().trim();
  const classification = $(cells[cells.length - 3]).text().trim();

  // Corrigendum PDF links inside the last cell
  const corrigendumLinks = $(cells[cells.length - 1])
    .find("a")
    .map((_, a) => $(a).attr("href"))
    .get()
    .filter(Boolean);

  // Capacity from description
  const mwMatch = description.match(/(\d[\d,.]*)\s*MW(?!h)/i);
  const mwhMatch = description.match(/(\d[\d,.]*)\s*MWh/i);

  matches.push({
    nit: sanitiseNit(nitRaw),
    rawNit: nitRaw,
    description,
    pdfHref,
    uploadDate,
    closingDate,
    circle,
    address,
    classification,
    corrigendumLinks,
    powerMW: mwMatch ? parseFloat(mwMatch[1].replace(/,/g, "")) : null,
    energyMWh: mwhMatch ? parseFloat(mwhMatch[1].replace(/,/g, "")) : null,
  });
}

console.log(`\nBESS matches: ${matches.length}`);
for (const m of matches) {
  console.log(
    `  ${m.rawNit.padEnd(40)} ${(m.powerMW || "?")}MW/${(m.energyMWh || "?")}MWh  ` +
    (m.corrigendumLinks.length > 0 ? `(+${m.corrigendumLinks.length} corr)  ` : "") +
    m.description.slice(0, 80),
  );
}

if (dryRun) {
  console.log("\n(dry-run — no writes)");
  process.exit(0);
}

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

let created = 0, updated = 0;

for (const m of matches) {
  const ref = doc(db, "tenders", m.nit);
  const existing = await getDoc(ref);
  const closeDate = parseDate(m.closingDate);
  const uploadDt = parseDate(m.uploadDate);

  const data = {
    nitNumber: m.nit,
    title: m.description.slice(0, 400),
    authority: "UJVNL",
    authorityType: "State Utility",
    state: "Uttarakhand",
    location: m.circle || null,
    powerMW: m.powerMW,
    energyMWh: m.energyMWh,
    bidDeadline: closeDate ? Timestamp.fromDate(closeDate) : null,
    daysLeft: closeDate ? Math.ceil((closeDate.getTime() - Date.now()) / 86400000) : null,
    tenderStatus: "closed",
    documentLink: m.pdfHref || null,
    sourceUrl: ARCHIVE_URL,
    sources: ["UJVNL-archive"],
    category: "Standalone",
    tenderMode: null,
    isCorrigendum: false,
    corrigendumOf: null,
    corrigendumCount: m.corrigendumLinks.length || null,
    flags: {},
    notes: {},
    lastUpdatedAt: Timestamp.now(),
  };
  if (existing.exists()) {
    // Don't stomp if another scraper already captured this tender — only fill
    // fields that are null.
    const cur = existing.data();
    const patch = {};
    for (const [k, v] of Object.entries(data)) {
      if (v != null && cur[k] == null) patch[k] = v;
    }
    // Always merge UJVNL-archive into sources array
    const mergedSources = Array.from(new Set([...(cur.sources || []), "UJVNL-archive"]));
    patch.sources = mergedSources;
    patch.lastUpdatedAt = Timestamp.now();
    await setDoc(ref, patch, { merge: true });
    updated++;
  } else {
    await setDoc(ref, { ...data, firstSeenAt: uploadDt ? Timestamp.fromDate(uploadDt) : Timestamp.now() });
    created++;
  }
  console.log(`  ${existing.exists() ? "↻" : "+"} ${m.nit}`);
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Total BESS matches: ${matches.length}`);
console.log(`Created: ${created} | Updated: ${updated}`);
process.exit(0);
