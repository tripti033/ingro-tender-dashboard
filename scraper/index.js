import "dotenv/config";
import { scrapeMercom } from "./sources/mercom.js";
import { scrapeSeci } from "./sources/seci.js";
import { scrapeNtpc } from "./sources/ntpc.js";
import { scrapeGuvnl } from "./sources/guvnl.js";
import { scrapeMsedcl } from "./sources/msedcl.js";
import { scrapeEprocure } from "./sources/eprocure.js";
import { scrapeGem } from "./sources/gem.js";
import { scrapeIreda } from "./sources/ireda.js";
import { scrapePowergrid } from "./sources/powergrid.js";
import { scrapeUktenders } from "./sources/uktenders.js";
import { scrapeHppcl } from "./sources/hppcl.js";
// TenderDetail scraper retired 2026-04 — too much noise, duplicate coverage
// of SECI/NTPC/etc. The file stays on disk in case we want to revisit it.
// import { scrapeTenderDetail } from "./sources/tenderdetail.js";
import { scrapeNgel } from "./sources/ngel.js";
import { scrapeMeda } from "./sources/meda.js";
import { scrapeTenderWizard } from "./sources/tenderwizard.js";
import { normaliseToSchema } from "./normaliser.js";
import { deduplicate } from "./dedup.js";
import { writeTenders, writeAlerts, writeIngestionLog } from "./firestore.js";

// Mercom is a news/alerts source — separated from tender scrapers
const ALERT_SOURCES = [
  { name: "Mercom", fn: scrapeMercom },
];

// Tender listing scrapers
const SOURCES = [
  { name: "SECI", fn: scrapeSeci },
  { name: "NTPC", fn: scrapeNtpc },
  { name: "GUVNL", fn: scrapeGuvnl },
  { name: "MSEDCL", fn: scrapeMsedcl },
  { name: "eProcure", fn: scrapeEprocure },
  { name: "GeM", fn: scrapeGem },
  { name: "IREDA", fn: scrapeIreda },
  { name: "POWERGRID", fn: scrapePowergrid },
  { name: "uktenders", fn: scrapeUktenders },
  { name: "HPPCL", fn: scrapeHppcl },
  // { name: "TenderDetail", fn: scrapeTenderDetail }, // retired — duplicate coverage + noisy data
  { name: "NGEL", fn: scrapeNgel },
  { name: "MEDA", fn: scrapeMeda },
  { name: "TenderWizard", fn: scrapeTenderWizard },
];

async function main() {
  const startTime = Date.now();
  console.log("=== BESS Tender Scraper — Ingro Energy ===");
  console.log(`Run started at ${new Date().toISOString()}\n`);

  // Run alert sources and tender sources in parallel
  const allJobs = [
    ...ALERT_SOURCES.map(({ name, fn }) =>
      fn().then((items) => ({ name, items, type: "alert" }))
    ),
    ...SOURCES.map(({ name, fn }) =>
      fn().then((items) => ({ name, items, type: "tender" }))
    ),
  ];
  const results = await Promise.allSettled(allJobs);

  // Collect results and track per-source stats
  const allRawTenders = [];
  const allRawAlerts = [];
  const sourceStats = {};
  let failedCount = 0;
  const errors = [];

  const allSourceNames = [...ALERT_SOURCES, ...SOURCES].map((s) => s.name);

  for (let i = 0; i < results.length; i++) {
    const sourceName = allSourceNames[i];
    const result = results[i];

    if (result.status === "fulfilled") {
      const { items, type } = result.value;
      sourceStats[sourceName] = {
        fetched: items.length,
        new: 0,
        errors: 0,
      };
      if (type === "alert") {
        allRawAlerts.push(
          ...items.map((t) => ({ raw: t, source: sourceName }))
        );
      } else {
        allRawTenders.push(
          ...items.map((t) => ({ raw: t, source: sourceName }))
        );
      }
    } else {
      failedCount++;
      const errMsg = `${sourceName}: ${result.reason?.message || result.reason}`;
      console.error(`[ERROR] ${errMsg}`);
      errors.push(errMsg);
      sourceStats[sourceName] = { fetched: 0, new: 0, errors: 1 };
    }
  }

  console.log(`\nRaw tenders collected: ${allRawTenders.length}`);

  // Normalise all raw tenders (regex only — LLM enrichment via llm-review.js)
  const normalised = allRawTenders
    .map(({ raw, source }) => {
      try {
        return normaliseToSchema(raw, source);
      } catch (err) {
        console.error(`[Normalise] Error for ${source}: ${err.message}`);
        errors.push(`Normalise error (${source}): ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);

  console.log(`Normalised tenders: ${normalised.length}`);

  // Deduplicate across all sources
  const unique = deduplicate(normalised);
  console.log(`After dedup: ${unique.length} unique tenders\n`);

  // Write tenders to Firestore
  let writeResult = { newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };
  try {
    writeResult = await writeTenders(unique);
    errors.push(...writeResult.errors);
  } catch (err) {
    console.error(`[Firestore] Fatal tender write error: ${err.message}`);
    errors.push(`Firestore write error: ${err.message}`);
  }

  // Write Mercom alerts to separate collection
  let alertsWritten = 0;
  if (allRawAlerts.length > 0) {
    try {
      alertsWritten = await writeAlerts(allRawAlerts);
    } catch (err) {
      console.error(`[Firestore] Alert write error: ${err.message}`);
      errors.push(`Alert write error: ${err.message}`);
    }
  }

  const durationMs = Date.now() - startTime;

  // Write ingestion log
  try {
    await writeIngestionLog({
      sources: sourceStats,
      totalNew: writeResult.newCount,
      totalUpdated: writeResult.updatedCount,
      totalSkipped: writeResult.skippedCount,
      durationMs,
      errors,
    });
  } catch (err) {
    console.error(`[Firestore] Could not write ingestion log: ${err.message}`);
  }

  // Print summary
  console.log("\n=== Run Summary ===");
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log("Per source:");
  for (const [source, stats] of Object.entries(sourceStats)) {
    const status = stats.errors > 0 ? "FAILED" : `${stats.fetched} found`;
    console.log(`  ${source.padEnd(10)} ${status}`);
  }
  console.log(`\nTenders unique: ${unique.length}`);
  console.log(`New: ${writeResult.newCount}`);
  console.log(`Updated: ${writeResult.updatedCount}`);
  console.log(`Skipped: ${writeResult.skippedCount}`);
  console.log(`Alerts written: ${alertsWritten}`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e}`));
  }
  console.log("==================\n");

  // Exit with code 1 if more than 5 sources failed (gov sites are often slow/down)
  if (failedCount > 5) {
    console.error(
      `${failedCount} sources failed (threshold: 5). Exiting with error.`
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
