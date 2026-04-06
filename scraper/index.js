import "dotenv/config";
import { scrapeMercom } from "./sources/mercom.js";
import { scrapeSeci } from "./sources/seci.js";
import { scrapeNtpc } from "./sources/ntpc.js";
import { scrapeGuvnl } from "./sources/guvnl.js";
import { scrapeMsedcl } from "./sources/msedcl.js";
import { normaliseToSchema } from "./normaliser.js";
import { deduplicate } from "./dedup.js";
import { writeTenders, writeIngestionLog } from "./firestore.js";

// All scraper sources with their names and functions
const SOURCES = [
  { name: "Mercom", fn: scrapeMercom },
  { name: "SECI", fn: scrapeSeci },
  { name: "NTPC", fn: scrapeNtpc },
  { name: "GUVNL", fn: scrapeGuvnl },
  { name: "MSEDCL", fn: scrapeMsedcl },
];

async function main() {
  const startTime = Date.now();
  console.log("=== BESS Tender Scraper — Ingro Energy ===");
  console.log(`Run started at ${new Date().toISOString()}\n`);

  // Run all 5 scrapers in parallel — one failure won't stop others
  const results = await Promise.allSettled(
    SOURCES.map(({ name, fn }) =>
      fn().then((tenders) => ({ name, tenders }))
    )
  );

  // Collect results and track per-source stats
  const allRawTenders = [];
  const sourceStats = {};
  let failedCount = 0;
  const errors = [];

  for (let i = 0; i < results.length; i++) {
    const sourceName = SOURCES[i].name;
    const result = results[i];

    if (result.status === "fulfilled") {
      const { tenders } = result.value;
      sourceStats[sourceName] = {
        fetched: tenders.length,
        new: 0, // will be updated after Firestore write
        errors: 0,
      };
      allRawTenders.push(
        ...tenders.map((t) => ({ raw: t, source: sourceName }))
      );
    } else {
      failedCount++;
      const errMsg = `${sourceName}: ${result.reason?.message || result.reason}`;
      console.error(`[ERROR] ${errMsg}`);
      errors.push(errMsg);
      sourceStats[sourceName] = { fetched: 0, new: 0, errors: 1 };
    }
  }

  console.log(`\nRaw tenders collected: ${allRawTenders.length}`);

  // Normalise all raw tenders to the unified schema
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

  // Write to Firestore
  let writeResult = { newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };
  try {
    writeResult = await writeTenders(unique);
    errors.push(...writeResult.errors);
  } catch (err) {
    console.error(`[Firestore] Fatal write error: ${err.message}`);
    errors.push(`Firestore write error: ${err.message}`);
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
  console.log(`\nTotal unique: ${unique.length}`);
  console.log(`New: ${writeResult.newCount}`);
  console.log(`Updated: ${writeResult.updatedCount}`);
  console.log(`Skipped: ${writeResult.skippedCount}`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e}`));
  }
  console.log("==================\n");

  // Exit with code 1 if more than 2 sources failed
  if (failedCount > 2) {
    console.error(
      `${failedCount} sources failed (threshold: 2). Exiting with error.`
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
