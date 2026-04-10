import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

// SECI's new website URLs (redesigned — old /view/publish/tender no longer works)
const SECI_TENDERS_URL = "https://www.seci.co.in/tenders";
const SECI_RESULTS_URL = "https://www.seci.co.in/tenders/results";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape SECI tender portal — both active tenders and results pages.
 * The new SECI site uses DataTables with all rows loaded client-side.
 * Table columns: S No | Tender ID | TSC on ETS Portal | Tender Ref No | Tender Title | Publication Date | Bid Submission Date | Tender Details
 */
export async function scrapeSeci() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map();

  try {
    // Scrape active tenders
    await scrapePage(page, SECI_TENDERS_URL, allTenders);
    await page.waitForTimeout(2000);

    // Scrape results (awarded tenders)
    await scrapePage(page, SECI_RESULTS_URL, allTenders);

    const tenders = Array.from(allTenders.values());

    // Filter by BESS keywords
    const filtered = tenders.filter((t) => {
      const text = `${t.title} ${t.nitNumber}`.toLowerCase();
      return BESS_KEYWORDS.some((kw) => text.includes(kw));
    });

    console.log(
      `[SECI] Found ${filtered.length} BESS tenders out of ${tenders.length} total`
    );
    return filtered;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape a single SECI page (active or results).
 */
async function scrapePage(page, url, tenderMap) {
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // DataTables loads all rows in the DOM — extract them all
    const rows = await page.evaluate(() => {
      const results = [];
      const tables = document.querySelectorAll("table");

      for (const table of tables) {
        const trs = table.querySelectorAll("tbody tr");
        for (const tr of trs) {
          const cells = tr.querySelectorAll("td");
          if (cells.length < 6) continue;

          const cellTexts = Array.from(cells).map(
            (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
          );

          // Get "View Details" link
          const detailLink = tr.querySelector('a[href*="tender-details"]');
          const detailUrl = detailLink ? detailLink.href : null;

          results.push({ cells: cellTexts, detailUrl });
        }
      }
      return results;
    });

    for (const row of rows) {
      const cells = row.cells;
      // Column layout: [0]=S.No [1]=Tender ID [2]=TSC on ETS [3]=Tender Ref No [4]=Tender Title [5]=Publication Date [6]=Bid Submission Date [7]=View Details
      // Archive has an extra column: [3]=Tender ID on CPPP, shifting others by 1

      const sno = cells[0];
      if (!/^\d+$/.test(sno)) continue; // Skip non-data rows

      // Detect if this is the archive layout (extra CPPP column)
      const hasExtraCol = cells.length >= 9;
      const offset = hasExtraCol ? 1 : 0;

      const tenderId = cells[1] || "";
      const tscEts = cells[2] || "";
      const tenderRef = cells[3 + offset] || "";
      const title = cells[4 + offset] || "";
      const pubDate = cells[5 + offset] || "";
      const bidDeadline = cells[6 + offset] || "";

      // Use TSC ETS portal ID or Tender Ref as NIT number
      const nitNumber = tscEts || tenderRef || tenderId;
      if (!nitNumber || nitNumber.length < 3) continue;
      if (!title || title.length < 5) continue;

      const key = nitNumber;
      if (!tenderMap.has(key)) {
        tenderMap.set(key, {
          nitNumber,
          title,
          authority: "SECI",
          bidDeadline: bidDeadline || null,
          documentLink: row.detailUrl || null,
          sourceUrl: url,
          source: "SECI",
          tenderRef,
          tenderId,
          pubDate,
        });
      }
    }

    console.log(`[SECI] Scraped ${url.split("/").pop()}: ${rows.length} rows`);
  } catch (err) {
    console.log(`[SECI] Failed to scrape ${url}: ${err.message}`);
  }
}
