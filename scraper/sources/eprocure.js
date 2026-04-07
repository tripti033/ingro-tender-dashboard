import { chromium } from "playwright";

const EPROCURE_URL = "https://eprocure.gov.in/eprocure/app";

// Multiple search terms to maximize coverage — the homepage search
// matches against tender titles, so we try several variations
const SEARCH_TERMS = [
  "battery energy storage",
  "BESS",
  "energy storage system",
  "battery storage",
  "grid scale battery",
  "standalone storage",
  "energy storage",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape eProcure (Central Public Procurement Portal) for BESS tenders.
 * Uses the homepage SearchDescription field which does NOT require CAPTCHA.
 * Searches multiple keyword variations to catch different title wordings.
 */
export async function scrapeEprocure() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map(); // dedup by tender ID within this source

  try {
    for (const term of SEARCH_TERMS) {
      try {
        await page.goto(EPROCURE_URL, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);

        // Fill the search field and submit
        const searchInput = await page.$("#SearchDescription");
        if (!searchInput) {
          console.log("[eProcure] Search field not found, skipping");
          break;
        }

        await searchInput.fill(term);
        await page.waitForTimeout(500);

        // Click the Go/Search button
        const submitBtn = await page.$("#Go");
        if (submitBtn) {
          await submitBtn.click();
        } else {
          await searchInput.press("Enter");
        }

        await page.waitForTimeout(3000);

        // Extract results from the tender table
        const rows = await page.evaluate(() => {
          const results = [];
          const tables = document.querySelectorAll("table");

          for (const table of tables) {
            const headerText = table.textContent || "";
            // Look for the results table that has tender columns
            if (
              !headerText.includes("e-Published Date") &&
              !headerText.includes("Tender ID")
            )
              continue;

            const trs = table.querySelectorAll("tr");
            for (const tr of trs) {
              const cells = tr.querySelectorAll("td");
              if (cells.length < 4) continue;

              const cellTexts = Array.from(cells).map(
                (c) => c.textContent?.trim() || ""
              );

              // Skip header-like rows
              if (
                cellTexts[0] === "S.No" ||
                cellTexts[0] === "" ||
                cellTexts.join("").includes("No Tenders found")
              )
                continue;

              const links = tr.querySelectorAll("a[href]");
              const docLink =
                Array.from(links)
                  .map((a) => a.href)
                  .find(
                    (h) =>
                      h.includes("tender") ||
                      h.includes("View") ||
                      h.includes(".pdf")
                  ) || null;

              results.push({ cells: cellTexts, docLink });
            }
          }
          return results;
        });

        // Parse each row into a tender object
        // Table columns: S.No | e-Published Date | Closing Date | Opening Date | Title and Ref.No./Tender ID | Organisation Chain
        for (const row of rows) {
          const cells = row.cells;
          if (cells.length < 5) continue;

          // Title + Ref column is usually index 4 (or the longest cell)
          const titleRefCell =
            cells.find((c) => c.length > 40) || cells[4] || "";

          // Extract tender ID/NIT — often in parentheses or after title
          const nitMatch = titleRefCell.match(
            /(?:Tender\s*ID|Ref\.?\s*No\.?)\s*[:.]?\s*([\w/\-. ]+)/i
          );
          const nitNumber = nitMatch ? nitMatch[1].trim() : null;

          // Clean title
          const title = titleRefCell
            .replace(/Tender\s*ID\s*[:.]?\s*[\w/\-. ]+/i, "")
            .replace(/Ref\.?\s*No\.?\s*[:.]?\s*[\w/\-. ]+/i, "")
            .trim()
            .slice(0, 300);

          // Parse dates — cells[1] = published, cells[2] = closing, cells[3] = opening
          const closingDate = cells[2] || null;

          // Organisation chain — last cell
          const orgChain = cells[cells.length - 1] || "";

          // Detect authority from org chain
          let authority = "eProcure";
          const knownAuthorities = [
            "SECI",
            "NTPC",
            "GUVNL",
            "MSEDCL",
            "SJVNL",
            "NHPC",
            "PGCIL",
            "POWERGRID",
            "MNRE",
            "CEA",
          ];
          for (const auth of knownAuthorities) {
            if (orgChain.toUpperCase().includes(auth)) {
              authority = auth;
              break;
            }
          }

          const key = nitNumber || title.slice(0, 50);
          if (!allTenders.has(key)) {
            allTenders.set(key, {
              nitNumber,
              title: title || titleRefCell,
              authority,
              bidDeadline: closingDate,
              documentLink: row.docLink,
              sourceUrl: EPROCURE_URL,
              source: "eProcure",
            });
          }
        }

        // Rate limit between searches
        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`[eProcure] Search "${term}" failed: ${err.message}`);
      }
    }

    const tenders = Array.from(allTenders.values());
    console.log(
      `[eProcure] Found ${tenders.length} BESS tenders (searched ${SEARCH_TERMS.length} terms)`
    );
    return tenders;
  } finally {
    await browser.close();
  }
}
