import { chromium } from "playwright";

// Search all regions (no region filter) and use keyword search for storage
const NTPC_URL =
  "https://ntpctender.ntpc.co.in/Index/Search?Type=Reg&Region=10";

const BESS_KEYWORDS = [
  "bess",
  "battery energy storage",
  "battery storage",
  "energy storage",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Max pages to paginate through to avoid infinite loops
const MAX_PAGES = 10;

/**
 * Scrape NTPC tender portal for BESS-related tenders.
 * Paginates through results table to find storage tenders.
 */
export async function scrapeNtpc() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    await page.goto(NTPC_URL, { waitUntil: "networkidle" });

    // Wait for the results table
    await page
      .waitForSelector("table", { timeout: 30000 })
      .catch(() => {
        console.log("[NTPC] No table found on initial load");
      });

    await page.waitForTimeout(2000);

    const tenders = [];
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      // Extract rows from current page
      const rows = await extractTableRows(page);

      for (const row of rows) {
        const fullText = row.cells.join(" ").toLowerCase();
        const isBESS = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
        if (!isBESS) continue;

        const cellText = row.cells.join(" ");

        // NIT/Tender ref is typically in the second column (index 1)
        const nitNumber = row.cells[1] || null;

        // Title is typically the third column (index 2) or longest cell
        const title =
          row.cells[2] ||
          row.cells.reduce((a, b) => (a.length > b.length ? a : b), "");

        // Closing date — look for date pattern in cells
        const dateCell = row.cells.find((c) =>
          /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(c)
        );

        // Extract EMD amount if mentioned
        const emdMatch = cellText.match(
          /EMD\s*[:.]?\s*(?:Rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(Cr|Lakh|Lac)?/i
        );
        let emdAmount = null;
        let emdUnit = null;
        if (emdMatch) {
          emdAmount = parseFloat(emdMatch[1].replace(/,/g, ""));
          emdUnit = emdMatch[2] || "INR";
        }

        tenders.push({
          nitNumber,
          title,
          authority: "NTPC",
          emdAmount,
          emdUnit,
          bidDeadline: dateCell || null,
          documentLink: row.docLink,
          sourceUrl: NTPC_URL,
          source: "NTPC",
        });
      }

      // Try to go to the next page
      const hasNext = await goToNextPage(page, currentPage);
      if (!hasNext) break;
      currentPage++;
      await page.waitForTimeout(2000);
    }

    console.log(
      `[NTPC] Found ${tenders.length} BESS tenders (scanned ${currentPage} page(s))`
    );
    return tenders;
  } finally {
    await browser.close();
  }
}

/**
 * Extract all data rows from the currently visible table.
 */
async function extractTableRows(page) {
  return page.evaluate(() => {
    const results = [];
    const tables = document.querySelectorAll("table");

    for (const table of tables) {
      const trs = table.querySelectorAll("tbody tr");
      for (const tr of trs) {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 3) continue;

        const cellTexts = Array.from(cells).map(
          (c) => c.textContent?.trim() || ""
        );

        const links = tr.querySelectorAll("a[href]");
        const docLink =
          Array.from(links)
            .map((a) => a.href)
            .find(
              (href) =>
                href.includes(".pdf") ||
                href.includes("download") ||
                href.includes("View") ||
                href.includes("Detail")
            ) || null;

        results.push({ cells: cellTexts, docLink });
      }
    }
    return results;
  });
}

/**
 * Try to navigate to the next page. Returns true if successful.
 */
async function goToNextPage(page, currentPage) {
  try {
    // Look for common pagination patterns: next button, page number links
    const nextButton = await page.$(
      'a:has-text("Next"), a:has-text("»"), a:has-text(">"), .pagination .next a, a[rel="next"]'
    );
    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(2000);
      return true;
    }

    // Try clicking the next page number directly
    const nextPageLink = await page.$(
      `.pagination a:has-text("${currentPage + 1}")`
    );
    if (nextPageLink) {
      await nextPageLink.click();
      await page.waitForTimeout(2000);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
