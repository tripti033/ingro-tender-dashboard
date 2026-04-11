import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

const IREDA_URL = "https://www.ireda.in/tender";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape IREDA (Indian Renewable Energy Development Agency) tender page.
 * Uses Playwright with fresh context to avoid cookie issues.
 * Table: Tender Title | Tender Ref.No | Expiry Date | Corrigendum
 */
export async function scrapeIreda() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto(IREDA_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const rows = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("table tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 3) return;

        const title = cells[0]?.textContent?.trim().replace(/\s+/g, " ") || "";
        const refNo = cells[1]?.textContent?.trim().replace(/\s+/g, " ") || "";
        const expiry = cells[2]?.textContent?.trim() || "";

        const docs = [];
        tr.querySelectorAll("a[href]").forEach((a) => {
          const href = a.href;
          const name = a.textContent?.trim() || "";
          if (href.match(/\.(pdf|doc|xlsx?)$/i) || href.includes("/tenderdetail/")) {
            docs.push({ name: name || href.split("/").pop(), url: href, uploadDate: null });
          }
        });

        results.push({ title, refNo, expiry, docs });
      });
      return results;
    });

    const tenders = [];
    for (const row of rows) {
      if (!row.title || row.title.length < 10) continue;

      const fullText = `${row.title} ${row.refNo}`.toLowerCase();
      const isBess = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
      if (!isBess) continue;

      tenders.push({
        nitNumber: row.refNo || null,
        title: row.title,
        authority: "IREDA",
        bidDeadline: row.expiry || null,
        documentLink: row.docs[0]?.url || null,
        documents: row.docs.length > 0 ? row.docs : null,
        sourceUrl: IREDA_URL,
        source: "IREDA",
      });
    }

    console.log(`[IREDA] Found ${tenders.length} BESS tenders out of ${rows.length} rows`);
    return tenders;
  } finally {
    await browser.close();
  }
}
