/**
 * Re-scrape the HPPCL listing and overwrite contacts on existing
 * Firestore tenders.
 *
 * The first pass of HPPCL had no contact extraction, so the LLM-PDF
 * step filled in the gap with whatever email/phone it could find in
 * the document — usually a generic dgm_elect@hppcl.in style box,
 * not the named officer printed on the listing detail page.
 *
 * scraper/sources/hppcl.js now reads contactPerson/Email/Phone from
 * the listing table, and scraper/firestore.js trusts those values.
 * This script just runs that pipeline for HPPCL alone so you don't
 * have to wait for the full multi-source scrape.
 *
 * Usage:
 *   node scraper/backfill-hppcl-contacts.js
 */
import "dotenv/config";
import { scrapeHppcl } from "./sources/hppcl.js";
import { normaliseToSchema } from "./normaliser.js";
import { initFirestore, writeTenders } from "./firestore.js";

await initFirestore();

console.log("Scraping HPPCL listing...");
const raw = await scrapeHppcl();
console.log(`HPPCL returned ${raw.length} tenders`);

const normalised = raw
  .map((r) => {
    try { return normaliseToSchema(r, "HPPCL"); }
    catch (e) { console.error(`Normalise failed for ${r.nitNumber}: ${e.message}`); return null; }
  })
  .filter(Boolean);

console.log(`Writing ${normalised.length} normalised tenders...`);
const stats = await writeTenders(normalised);
console.log(`\n${"═".repeat(50)}`);
console.log(JSON.stringify(stats, null, 2));
process.exit(0);
