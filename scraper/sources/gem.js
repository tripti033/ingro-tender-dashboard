import { chromium } from "playwright";

const GEM_BIDS_URL = "https://bidplus.gem.gov.in/all-bids";

const SEARCH_TERMS = [
  "battery energy storage",
  "BESS",
  "energy storage system",
  "battery storage",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape GeM (Government e-Marketplace) bidplus portal for BESS-related bids.
 * Uses the searchBid field on the all-bids page which triggers AJAX search.
 */
export async function scrapeGem() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map(); // dedup within source by bid number

  try {
    for (const term of SEARCH_TERMS) {
      try {
        await page.goto(GEM_BIDS_URL, { waitUntil: "networkidle" });
        await page.waitForTimeout(3000);

        // Find the searchBid input
        const searchInput = await page.$("#searchBid");
        if (!searchInput) {
          console.log("[GeM] searchBid field not found, trying alternatives");
          // Try other possible selectors
          const altInput = await page.$(
            'input[type="search"], input[placeholder*="Keyword"]'
          );
          if (!altInput) {
            console.log("[GeM] No search field found, skipping");
            break;
          }
          await altInput.fill(term);
        } else {
          await searchInput.fill(term);
        }

        await page.waitForTimeout(500);

        // Click the search button
        const searchBtn = await page.$("#searchBidRA");
        if (searchBtn) {
          await searchBtn.click();
        } else {
          // Try pressing Enter or finding any search button
          const btn = await page.$(
            'button[type="submit"], input[type="submit"], .search-btn'
          );
          if (btn) await btn.click();
          else await (searchInput || page).press?.("Enter");
        }

        // Wait for AJAX results to load
        await page.waitForTimeout(5000);

        // Extract bid data from the page
        const bids = await page.evaluate(() => {
          const results = [];

          // GeM renders bids as cards/divs or table rows
          // Try multiple selectors
          const cards = document.querySelectorAll(
            ".bid-item, .bid-card, .card, [class*='bid'], table tbody tr"
          );

          for (const card of cards) {
            const text = card.textContent?.trim() || "";
            if (text.length < 20) continue;

            // Extract bid number (GEM/YYYY/B/NNNNN format)
            const bidNoMatch = text.match(/GEM\/\d{4}\/[A-Z]+\/\d+/);
            const bidNo = bidNoMatch ? bidNoMatch[0] : null;

            // Extract title — usually the most prominent text
            const titleEl = card.querySelector(
              "h4, h5, .bid-title, .title, a"
            );
            const title = titleEl?.textContent?.trim() || text.slice(0, 200);

            // Extract dates
            const dateMatch = text.match(
              /(?:closing|end|last)\s*(?:date|time)?\s*[:.]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i
            );
            const closingDate = dateMatch ? dateMatch[1] : null;

            // Extract value/amount
            const valueMatch = text.match(
              /(?:estimated|total|bid)\s*(?:value|amount)?\s*[:.]?\s*(?:Rs\.?\s*|INR\s*)?(\d[\d,.]*)\s*(Cr|Lakh|Lac)?/i
            );

            // Extract link
            const link = card.querySelector("a[href]")?.href || null;

            if (bidNo || title.length > 30) {
              results.push({
                bidNo,
                title,
                closingDate,
                value: valueMatch ? valueMatch[1] : null,
                valueUnit: valueMatch ? valueMatch[2] : null,
                link,
              });
            }
          }

          // Also try extracting from any rendered list structure
          document
            .querySelectorAll(
              ".block, .bid-listing, [id*='bid'], .listing-item"
            )
            .forEach((el) => {
              const text = el.textContent?.trim() || "";
              const bidNoMatch = text.match(/GEM\/\d{4}\/[A-Z]+\/\d+/);
              const titleEl = el.querySelector("a, h4, h5, .title");
              const link = el.querySelector("a[href]")?.href || null;

              if (bidNoMatch || (text.length > 50 && titleEl)) {
                results.push({
                  bidNo: bidNoMatch ? bidNoMatch[0] : null,
                  title: titleEl?.textContent?.trim() || text.slice(0, 200),
                  closingDate: null,
                  value: null,
                  valueUnit: null,
                  link,
                });
              }
            });

          return results;
        });

        for (const bid of bids) {
          const key = bid.bidNo || bid.title.slice(0, 60);
          if (!allTenders.has(key)) {
            allTenders.set(key, {
              nitNumber: bid.bidNo,
              title: bid.title,
              authority: "GeM",
              bidDeadline: bid.closingDate,
              emdAmount: bid.value
                ? parseFloat(bid.value.replace(/,/g, ""))
                : null,
              emdUnit: bid.valueUnit || null,
              documentLink: bid.link,
              sourceUrl: GEM_BIDS_URL,
              source: "GeM",
            });
          }
        }

        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`[GeM] Search "${term}" failed: ${err.message}`);
      }
    }

    const tenders = Array.from(allTenders.values());
    console.log(
      `[GeM] Found ${tenders.length} BESS bids (searched ${SEARCH_TERMS.length} terms)`
    );
    return tenders;
  } finally {
    await browser.close();
  }
}
