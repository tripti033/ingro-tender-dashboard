import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

const POWERGRID_URL = "https://apps.powergrid.in/pgciltenders/u/default.aspx";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape POWERGRID tender portal (ASP.NET app).
 * Extracts tender listing table and filters by BESS keywords.
 */
export async function scrapePowergrid() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    await page.goto(POWERGRID_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    // Extract all table rows
    const rows = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("table tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 3) return;

        const cellTexts = Array.from(cells).map(
          (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
        );

        const links = [];
        tr.querySelectorAll("a[href]").forEach((a) => {
          const href = a.href;
          const name = a.textContent?.trim() || "";
          if (href && !href.includes("javascript")) {
            links.push({ name, url: href });
          }
        });

        results.push({ cells: cellTexts, links });
      });
      return results;
    });

    const tenders = [];

    for (const row of rows) {
      const fullText = row.cells.join(" ").toLowerCase();

      // Filter by BESS keywords
      const isBess = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
      if (!isBess) continue;

      // Find the title — usually the longest cell
      const title = row.cells.reduce((a, b) => (a.length > b.length ? a : b), "");
      if (!title || title.length < 10) continue;

      // Find NIT/ref number — look for cells with slashes or numbers
      const nitCell = row.cells.find((c) =>
        /\d{2,}/.test(c) && c.length < 50 && c !== title
      );

      // Find date
      const dateCell = row.cells.find((c) =>
        /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(c)
      );

      // Get document links
      const docLinks = row.links.filter((l) =>
        l.url.match(/\.(pdf|doc|xlsx?)$/i) || l.url.includes("download")
      );

      tenders.push({
        nitNumber: nitCell || null,
        title,
        authority: "POWERGRID",
        bidDeadline: dateCell || null,
        documentLink: docLinks[0]?.url || null,
        documents: docLinks.length > 0 ? docLinks.map((l) => ({ name: l.name, url: l.url, uploadDate: null })) : null,
        sourceUrl: POWERGRID_URL,
        source: "POWERGRID",
      });
    }

    console.log(`[POWERGRID] Found ${tenders.length} BESS tenders out of ${rows.length} rows`);
    return tenders;
  } finally {
    await browser.close();
  }
}
