import { chromium } from "playwright";

const GEM_BIDS_URL = "https://bidplus.gem.gov.in/all-bids";
const GEM_API_URL = "https://bidplus.gem.gov.in/all-bids-data";

const SEARCH_TERMS = [
  "battery energy storage",
  "BESS",
  "energy storage system",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape GeM (Government e-Marketplace) for BESS-related bids.
 * Intercepts the JSON API response from /all-bids-data for clean structured data.
 */
export async function scrapeGem() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map();

  try {
    for (const term of SEARCH_TERMS) {
      try {
        // Collect API responses
        const apiData = [];
        page.on("response", async (response) => {
          if (response.url().includes("all-bids-data")) {
            try {
              const json = await response.json();
              apiData.push(json);
            } catch {
              // Not JSON
            }
          }
        });

        await page.goto(GEM_BIDS_URL, { waitUntil: "networkidle" });
        await page.waitForTimeout(3000);

        // Search using the searchBid input
        const searchInput = await page.$("#searchBid");
        if (!searchInput) {
          console.log("[GeM] searchBid field not found");
          break;
        }

        await searchInput.fill(term);
        await page.waitForTimeout(500);

        const searchBtn = await page.$("#searchBidRA");
        if (searchBtn) {
          await searchBtn.click();
        } else {
          await searchInput.press("Enter");
        }

        // Wait for the API response
        await page.waitForTimeout(5000);

        // Parse intercepted API data
        for (const json of apiData) {
          const docs =
            json?.response?.response?.docs ||
            json?.response?.docs ||
            [];

          for (const bid of docs) {
            const bidNumber = Array.isArray(bid.b_bid_number)
              ? bid.b_bid_number[0]
              : bid.b_bid_number || null;

            if (!bidNumber) continue;

            // Build title from category/item names
            const categoryName = Array.isArray(bid.b_category_name)
              ? bid.b_category_name.join(", ")
              : bid.b_category_name || "";

            // Get department/ministry info
            const ministry = Array.isArray(bid.ba_official_details_minName)
              ? bid.ba_official_details_minName[0]
              : bid.ba_official_details_minName || "";
            const department = Array.isArray(bid.ba_official_details_deptName)
              ? bid.ba_official_details_deptName[0]
              : bid.ba_official_details_deptName || "";

            const title = categoryName || `${ministry} - ${department}`;

            // Skip if title is too short or clearly not useful
            if (!title || title.length < 5) continue;

            // Parse dates
            const endDate = Array.isArray(bid.final_end_date_sort)
              ? bid.final_end_date_sort[0]
              : bid.final_end_date_sort || null;

            // Build document link
            const internalId = Array.isArray(bid.b_id)
              ? bid.b_id[0]
              : bid.b_id || bid.id;
            const docLink = internalId
              ? `https://bidplus.gem.gov.in/showbidDocument/${internalId}`
              : null;

            // Quantity
            const quantity = Array.isArray(bid.b_total_quantity)
              ? bid.b_total_quantity[0]
              : bid.b_total_quantity || null;

            if (!allTenders.has(bidNumber)) {
              allTenders.set(bidNumber, {
                nitNumber: bidNumber,
                title: `${title}${quantity ? ` (Qty: ${quantity})` : ""}`,
                authority: "GeM",
                bidDeadline: endDate,
                documentLink: docLink,
                sourceUrl: GEM_BIDS_URL,
                source: "GeM",
                description: `${ministry} | ${department}`,
              });
            }
          }
        }

        // Clear listener for next search term
        page.removeAllListeners("response");
        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`[GeM] Search "${term}" failed: ${err.message}`);
        page.removeAllListeners("response");
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
