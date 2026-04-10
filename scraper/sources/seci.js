import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

const SECI_TENDERS_URL = "https://www.seci.co.in/tenders";
const SECI_RESULTS_URL = "https://www.seci.co.in/tenders/results";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape SECI tender portal — active tenders + results.
 * For BESS-matched tenders, navigates to detail page to extract
 * financial instruments, key dates, and document links.
 */
export async function scrapeSeci() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map();

  try {
    // Scrape listing pages
    await scrapeListingPage(page, SECI_TENDERS_URL, allTenders);
    await page.waitForTimeout(2000);
    await scrapeListingPage(page, SECI_RESULTS_URL, allTenders);

    // Filter by BESS keywords
    const tenders = Array.from(allTenders.values());
    const bessTenders = tenders.filter((t) => {
      const text = `${t.title} ${t.nitNumber} ${t.description || ""}`.toLowerCase();
      return BESS_KEYWORDS.some((kw) => text.includes(kw));
    });

    // Navigate to detail page for each BESS tender to get rich data
    for (const tender of bessTenders) {
      if (tender.detailUrl) {
        try {
          await page.waitForTimeout(2000); // rate limit
          await extractDetailPage(page, tender);
        } catch (err) {
          console.log(`[SECI] Detail page failed for ${tender.nitNumber}: ${err.message}`);
        }
      }
    }

    console.log(
      `[SECI] Found ${bessTenders.length} BESS tenders out of ${tenders.length} total`
    );
    return bessTenders;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape a SECI listing page (active or results).
 * DataTables renders all rows client-side.
 */
async function scrapeListingPage(page, url, tenderMap) {
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const rows = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("table tbody tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 6) return;

        const cellTexts = Array.from(cells).map(
          (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
        );

        const detailLink = tr.querySelector('a[href*="tender-details"]');
        results.push({
          cells: cellTexts,
          detailUrl: detailLink ? detailLink.href : null,
        });
      });
      return results;
    });

    for (const row of rows) {
      const cells = row.cells;
      const sno = cells[0];
      if (!/^\d+$/.test(sno)) continue;

      // Detect archive layout (extra CPPP column)
      const hasExtraCol = cells.length >= 9;
      const offset = hasExtraCol ? 1 : 0;

      const tenderId = cells[1] || "";
      const tscEts = cells[2] || "";
      const tenderRef = cells[3 + offset] || "";
      const title = cells[4 + offset] || "";
      const pubDate = cells[5 + offset] || "";
      const bidDeadline = cells[6 + offset] || "";

      const nitNumber = tscEts || tenderRef || tenderId;
      if (!nitNumber || nitNumber.length < 3) continue;
      if (!title || title.length < 5) continue;

      if (!tenderMap.has(nitNumber)) {
        tenderMap.set(nitNumber, {
          nitNumber,
          title,
          authority: "SECI",
          bidDeadline: bidDeadline || null,
          sourceUrl: url,
          source: "SECI",
          tenderRef,
          tenderId,
          pubDate,
          detailUrl: row.detailUrl,
          // These will be filled from detail page
          documentLink: null,
          description: null,
          tenderMode: null,
          emdAmount: null,
          emdUnit: null,
          tenderProcessingFee: null,
          preBidDate: null,
          biddingStructure: null,
        });
      }
    }

    console.log(`[SECI] Scraped ${url.split("/").pop()}: ${rows.length} rows`);
  } catch (err) {
    console.log(`[SECI] Failed to scrape ${url}: ${err.message}`);
  }
}

/**
 * Navigate to a SECI tender detail page and extract rich data.
 * Sections: Tender Basic Details (table[2]), Financial Instruments (table[5]),
 * Key Dates (table[8]), Documents (table[9]).
 */
async function extractDetailPage(page, tender) {
  await page.goto(tender.detailUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const details = await page.evaluate(() => {
    const data = {};
    const tables = document.querySelectorAll("table");

    // Helper: extract label→value pairs from a table
    function extractPairs(table) {
      const pairs = {};
      if (!table) return pairs;
      table.querySelectorAll("tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        // Tables have 2 or 4 columns (label, value, label, value)
        for (let i = 0; i < cells.length - 1; i += 2) {
          const label = cells[i]?.textContent?.trim().replace(/\s+/g, " ") || "";
          const value = cells[i + 1]?.textContent?.trim().replace(/\s+/g, " ") || "";
          if (label && value) pairs[label] = value;
        }
      });
      return pairs;
    }

    // Tender Basic Details — table[2]
    if (tables[2]) Object.assign(data, extractPairs(tables[2]));
    // Financial Instruments — table[5]
    if (tables[5]) Object.assign(data, extractPairs(tables[5]));
    // Key Dates — table[8]
    if (tables[8]) Object.assign(data, extractPairs(tables[8]));

    // Documents — collect ALL docs from all tables (Tender Documents + Corrigendums)
    const documents = [];
    for (const table of tables) {
      table.querySelectorAll("a[href]").forEach((a) => {
        const href = a.href;
        if (href.includes("/uploads/tenders/") && href.match(/\.(pdf|xlsx?)$/i)) {
          const name = a.textContent?.trim() || href.split("/").pop() || "";
          // Get upload date from sibling/next cell
          const row = a.closest("tr");
          const cells = row ? row.querySelectorAll("td") : [];
          const dateCell = Array.from(cells).find((c) =>
            /\d{2}\/\d{2}\/\d{4}/.test(c.textContent || "")
          );
          const uploadDate = dateCell ? dateCell.textContent?.trim() : null;

          // Avoid duplicates
          if (!documents.some((d) => d.url === href)) {
            documents.push({ name, url: href, uploadDate });
          }
        }
      });
    }
    data._documents = documents;

    return data;
  });

  // Map extracted data to tender fields
  tender.description = details["Tender Description"] || null;
  tender.biddingStructure = details["Tender Type"] || null;

  // Financial
  const costOfRfs = details["Cost of RFS"] || details["Cost of RfS"] || null;
  if (costOfRfs) {
    const match = costOfRfs.match(/([\d,]+)/);
    if (match) tender.tenderProcessingFee = parseFloat(match[1].replace(/,/g, ""));
  }

  const emd = details["EMD"] || null;
  if (emd && emd !== "As per RfS document") {
    const match = emd.match(/([\d,]+)/);
    if (match) {
      tender.emdAmount = parseFloat(match[1].replace(/,/g, ""));
      tender.emdUnit = "INR";
    }
  }

  // Key Dates
  const preBid = details["Pre Bid Meeting Date"] || null;
  if (preBid) tender.preBidDate = preBid.split(" ")[0]; // DD/MM/YYYY part only

  const bidOpen = details["Bid Open Date"] || null;
  if (bidOpen) tender.techBidOpeningDate = bidOpen.split(" ")[0];

  // Documents — save all as array, set primary documentLink to the RfS doc
  const docs = details._documents || [];
  if (docs.length > 0) {
    tender.documents = docs;
    // Primary doc link: prefer RfS/selection doc
    const rfsDoc = docs.find((d) =>
      /rfs|rps|selection/i.test(d.name) && !/(integrity|format|clarification)/i.test(d.name)
    );
    tender.documentLink = rfsDoc ? rfsDoc.url : docs[0].url;
  }

  console.log(`[SECI] Detail extracted: ${tender.nitNumber} — ${tender.title.slice(0, 50)}`);
}
