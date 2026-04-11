import { chromium } from "playwright";

const GUVNL_URL = "https://tender.guvnl.com/";

import { BESS_KEYWORDS } from "../keywords.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Max pages to scan — GUVNL has 60+ pages; scan enough to find recent BESS tenders
const MAX_PAGES = 15;

/**
 * Scrape GUVNL (Gujarat Urja Vikas Nigam) tender portal for BESS tenders.
 * Paginates through the results table (10 entries per page, 633+ total).
 */
export async function scrapeGuvnl() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    await page.goto(GUVNL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Wait for the main tender table
    await page
      .waitForSelector("table", { timeout: 30000 })
      .catch(() => {
        console.log("[GUVNL] No table found on initial load");
      });

    await page.waitForTimeout(2000);

    // Try to increase items per page if a "show entries" dropdown exists
    await tryShowAllEntries(page);

    const tenders = [];
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      const rows = await extractTableRows(page);

      for (const row of rows) {
        const fullText = row.cells.join(" ").toLowerCase();
        const isBESS = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
        if (!isBESS) continue;

        const cellText = row.cells.join(" ");

        // Extract NIT / tender number
        const nitMatch = cellText.match(
          /(?:NIT|Tender)\s*(?:No\.?|#)?\s*[:.]?\s*([\w/\-. ]+\d[\w/\-. ]*)/i
        );
        const nitNumber = nitMatch
          ? nitMatch[1].trim()
          : row.cells[0] || null;

        const title =
          row.cells.reduce((a, b) => (a.length > b.length ? a : b), "") ||
          "";

        const dateCell = row.cells.find((c) =>
          /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(c)
        );

        tenders.push({
          nitNumber,
          title,
          authority: "GUVNL",
          bidDeadline: dateCell || null,
          documentLink: row.docLink,
          sourceUrl: GUVNL_URL,
          source: "GUVNL",
        });
      }

      // Try to go to the next page
      const hasNext = await goToNextPage(page, currentPage);
      if (!hasNext) break;
      currentPage++;
      await page.waitForTimeout(2000);
    }

    console.log(
      `[GUVNL] Found ${tenders.length} BESS tenders (scanned ${currentPage} page(s))`
    );
    return tenders;
  } finally {
    await browser.close();
  }
}

/**
 * Try to set the table to show more entries per page (e.g., 100 instead of 10).
 */
async function tryShowAllEntries(page) {
  try {
    // DataTables-style "Show X entries" dropdown
    const select = await page.$('select[name*="length"], .dataTables_length select');
    if (select) {
      // Try to select the highest value option
      const options = await select.$$eval("option", (opts) =>
        opts.map((o) => o.value)
      );
      const maxVal =
        options.find((v) => v === "-1") || // -1 = "All"
        options.find((v) => parseInt(v) >= 100) ||
        options[options.length - 1];
      if (maxVal) {
        await select.selectOption(maxVal);
        await page.waitForTimeout(3000);
        console.log(`[GUVNL] Set entries per page to ${maxVal}`);
      }
    }
  } catch {
    // No dropdown — continue with default pagination
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
        if (cells.length < 2) continue;

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
                href.includes("tender") ||
                href.includes("view")
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
    // DataTables next button
    const nextButton = await page.$(
      '.paginate_button.next:not(.disabled), a:has-text("Next"):not(.disabled), a:has-text("»"), .pagination .next a'
    );
    if (nextButton) {
      const isDisabled = await nextButton.evaluate((el) =>
        el.classList.contains("disabled") ||
        el.getAttribute("aria-disabled") === "true"
      );
      if (!isDisabled) {
        await nextButton.click();
        await page.waitForTimeout(2000);
        return true;
      }
    }

    // Try clicking next page number
    const nextPageLink = await page.$(
      `.pagination a:has-text("${currentPage + 1}"), .paginate_button:has-text("${currentPage + 1}")`
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
